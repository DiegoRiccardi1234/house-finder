import type { StoredListing } from '../core/store.js';
import type { Profile } from '../config/profile.js';
import { cityOf } from '../core/rules.js';
import { haversineKm, insidePolygon } from '../core/geo.js';

/**
 * I filtri della pagina Annunci, sul modello di Immobiliare: prezzo, superficie, locali, bagni,
 * piano, caratteristiche, distanza.
 *
 * Due famiglie, con due regole diverse sul dato mancante:
 * - **misure** (prezzo, m², locali, bagni): un annuncio che non le dichiara PASSA. Su Facebook il
 *   prezzo manca spesso, e sparirebbero proprio i privati;
 * - **caratteristiche** (ascensore, aria condizionata, riscaldamento autonomo, piano): passano solo
 *   se dichiarate. Chiedere "con ascensore" e vedere case che non lo dicono non è un filtro.
 */

export type Query = Record<string, unknown>;

export interface ListingView extends StoredListing {
  /** Distanza in linea d'aria dal punto di riferimento della città, se entrambi noti. */
  distanceKm?: number | null;
}

const str = (q: Query, k: string): string => (typeof q[k] === 'string' ? (q[k] as string) : '');
const num = (q: Query, k: string): number | null => {
  const v = str(q, k);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export type FloorKind = 'terra' | 'intermedio' | 'ultimo';

/** Il piano scritto come capita ("T", "rialzato", "3° di 5", "ultimo") ridotto a tre classi. */
export function floorKind(piano: string | null | undefined): FloorKind | null {
  if (!piano) return null;
  const s = piano.toLowerCase().trim();
  if (/ultim|attico|mansard/.test(s)) return 'ultimo';
  const of = s.match(/(\d+)\D+(?:di|su|\/)\D*(\d+)/);
  if (of && of[1] === of[2]) return 'ultimo';
  // Seminterrato e interrati («-1», «S1») contano come terra: sono il caso da evitare insieme.
  if (/terra|rialzat|seminterr|interrat|^-\s*\d|^s\s*\d|^t\b|^pt\b|^0\b|^piano\s*0\b/.test(s)) return 'terra';
  const n = s.match(/\d+/);
  if (n) return Number(n[0]) === 0 ? 'terra' : 'intermedio';
  return null;
}

export const priceOf = (r: StoredListing): number | null => r.listing.price ?? r.fields?.prezzo ?? null;
export const sqmOf = (r: StoredListing): number | null => r.listing.sizeSqm ?? r.fields?.m2 ?? null;
export const roomsOf = (r: StoredListing): number | null => r.fields?.locali ?? r.listing.rooms ?? null;

/** Distanza dal riferimento della città dell'annuncio. */
export function distanceOf(r: StoredListing, profile: Profile): number | null {
  if (!r.geo) return null;
  const city = cityOf(r, profile);
  const ref = (city ? profile.zones.find((z) => z.city === city) : profile.zones.find((z) => z.riferimento))?.riferimento;
  if (!ref) return null;
  return Math.round(haversineKm(r.geo, ref) * 10) / 10;
}

/**
 * Dentro l'area della sua città? `'n/a'` = per quella città non c'è un'area disegnata: il filtro
 * non la riguarda e l'annuncio resta (prima valeva come "posizione ignota" e spariva).
 */
function inArea(r: StoredListing, profile: Profile): boolean | null | 'n/a' {
  const city = cityOf(r, profile);
  const poly = (city ? profile.zones.find((z) => z.city === city) : undefined)?.area?.polygon;
  if (!poly || poly.length < 3) return 'n/a';
  if (!r.geo) return null;
  return insidePolygon(r.geo, poly);
}

/** Filtra e ordina i record per la GET /api/listings. */
export function queryListings(all: StoredListing[], q: Query, profile: Profile): ListingView[] {
  const channel = str(q, 'channel');
  const status = str(q, 'status');
  const city = str(q, 'city').toLowerCase();
  const text = str(q, 'q').toLowerCase();
  const arredato = str(q, 'arredato');
  const soloPrivati = q.soloPrivati === '1';
  const minScore = num(q, 'minScore') ?? 0;
  const sort = str(q, 'sort') || 'score';
  const priceMin = num(q, 'priceMin');
  const priceMax = num(q, 'priceMax');
  const sqmMin = num(q, 'sqmMin');
  const sqmMax = num(q, 'sqmMax');
  const rooms = str(q, 'rooms').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const bagni = num(q, 'bagni');
  const piano = str(q, 'piano').split(',').filter((p): p is FloorKind => p === 'terra' || p === 'intermedio' || p === 'ultimo');
  const ascensore = q.ascensore === '1';
  const aria = q.aria === '1';
  const autonomo = q.autonomo === '1';
  const days = num(q, 'days');
  const maxKm = num(q, 'maxKm');
  const onlyArea = q.inArea === '1';
  const withoutGeo = q.withoutGeo !== '0'; // di default chi non ha posizione resta
  const since = days && days > 0 ? Date.now() - days * 86_400_000 : null;

  const views: ListingView[] = all.map((r) => ({ ...r, distanceKm: distanceOf(r, profile) }));

  const out = views.filter((r) => {
    // Mantiene sia il canale corrente sia quelli storici, senza migrare l'archivio.
    if (channel && !(channel === 'facebook'
      ? ['facebook', 'fb-group', 'fb-marketplace'].includes(r.channel)
      : r.channel === channel)) {
      return false;
    }
    if (status === 'active') { if (r.status === 'dismissed') return false; }
    else if (status === 'ask') { if (!r.askOwner || r.status === 'dismissed') return false; }
    else if (status && r.status !== status) return false;
    if (minScore > 0 && (r.ai == null || r.ai.score < minScore)) return false;
    if (arredato && r.fields?.arredato !== arredato) return false;
    if (soloPrivati && r.fields?.contatto === 'agenzia') return false;
    if (city) {
      const hay = `${r.city ?? ''} ${r.listing.zone ?? ''} ${r.listing.title} ${r.listing.url}`.toLowerCase();
      if (!hay.includes(city)) return false;
    }
    if (text) {
      const hay = `${r.listing.title} ${r.listing.zone ?? ''} ${r.listing.desc ?? ''} ${r.fields?.zona ?? ''} ${r.fields?.indirizzo ?? ''}`.toLowerCase();
      if (!hay.includes(text)) return false;
    }

    const price = priceOf(r);
    if (price != null && priceMin != null && price < priceMin) return false;
    if (price != null && priceMax != null && price > priceMax) return false;
    const sqm = sqmOf(r);
    if (sqm != null && sqmMin != null && sqm < sqmMin) return false;
    if (sqm != null && sqmMax != null && sqm > sqmMax) return false;
    const locali = roomsOf(r);
    if (rooms.length && locali != null && !rooms.some((n) => (n >= 4 ? locali >= 4 : locali === n))) return false;
    const b = r.fields?.bagni ?? null;
    if (bagni != null && b != null && b < bagni) return false;

    if (piano.length) {
      const k = floorKind(r.fields?.piano);
      if (!k || !piano.includes(k)) return false;
    }
    if (ascensore && r.fields?.ascensore !== true) return false;
    if (aria && r.fields?.aria_condizionata !== true) return false;
    if (autonomo && !/autonom/i.test(r.fields?.riscaldamento ?? '')) return false;

    if (since != null && Date.parse(r.firstSeen) < since) return false;
    if (maxKm != null) {
      if (r.distanceKm == null) { if (!withoutGeo) return false; }
      else if (r.distanceKm > maxKm) return false;
    }
    if (onlyArea) {
      const inside = inArea(r, profile);
      if (inside === false) return false;
      if (inside === null && !withoutGeo) return false;
    }
    return true;
  });

  const byScore = (a: ListingView, b: ListingView) => (b.ai?.score ?? -1) - (a.ai?.score ?? -1);
  const byRecent = (a: ListingView, b: ListingView) => b.firstSeen.localeCompare(a.firstSeen);
  const byPrice = (a: ListingView, b: ListingView) => (priceOf(a) ?? Infinity) - (priceOf(b) ?? Infinity);
  const byDistance = (a: ListingView, b: ListingView) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || byScore(a, b);
  return out.sort(sort === 'recent' ? byRecent : sort === 'price' ? byPrice : sort === 'distance' ? byDistance : byScore);
}
