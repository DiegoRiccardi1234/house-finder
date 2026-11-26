import type { AutoDecision, StoredListing } from './store.js';
import type { CityZones, Profile, SearchRow } from '../config/profile.js';
import { DEFAULT_ASK_THRESHOLD } from '../config/profile.js';
import { citySlugOf } from '../config/cities.js';
import { insidePolygon, preciseEnough } from './geo.js';

/**
 * Le regole del profilo, applicate IN CODICE.
 *
 * Prima tipologia, prezzo e zona vivevano solo nel prompt: l'AI abbassava il voto ma l'annuncio
 * restava in lista, e chi apriva l'app vedeva trilocali e case lontane come se fossero candidate.
 * Qui si decide in modo verificabile, con il motivo scritto sull'annuncio.
 *
 * Tre principi:
 * - **in dubbio NON scartare**: un dato mancante (prezzo, locali, posizione) non è una violazione;
 * - **mai sopra l'utente**: si toccano solo gli annunci `new` o scartati da una regola; uno stato
 *   scelto a mano (UI o agente) non viene mai cambiato;
 * - **reversibile**: se il profilo cambia e l'annuncio torna valido, rientra fra i nuovi.
 */

export interface Violation {
  rule: AutoDecision['rule'];
  reason: string;
}

export interface RulesResult {
  dismissed: number;
  restored: number;
  ask: number;
}

const NOT_RENTAL = /\b(vendita|in vendita|casa vacanz|affitto breve|vacanza|b&b|bed and breakfast)\b/i;
const SHARED = /posto letto|condivis|coinquilin/i;
const ROOM_START = /^\s*(stanz[ae]|camer[ae])\b/i;
const NOT_A_ROOM = /indipendent|monolocal|bilocal|loft|mini ?appartament/i;

/** La tipologia descrive una stanza in casa d'altri, non una casa intera? */
export function isRoomOffer(tipologia: string | null | undefined, title = ''): boolean {
  const t = (tipologia ?? '').toLowerCase();
  if (t) {
    if (SHARED.test(t)) return true;
    return ROOM_START.test(t) && !NOT_A_ROOM.test(t);
  }
  // Senza tipologia dall'AI si guarda solo l'inizio del titolo, come `matches()` per gli scraper.
  return /^\s*(?:(?:affittasi|affitto|offro)\s+)?(?:stanza|camera|posto letto)\b/i.test(title) && !NOT_A_ROOM.test(title);
}

const wantsRooms = (s: SearchRow): boolean =>
  s.tipo === 'stanza' || (!s.tipo && /stanza|camera singola/i.test(s.label));

/** Le ricerche che valgono per l'annuncio: quelle della sua città, o tutte se non si sa. */
function searchesFor(city: string | null, p: Profile): SearchRow[] {
  const own = city ? p.searches.filter((s) => s.city === city) : [];
  return own.length ? own : p.searches;
}

/** La città dell'annuncio: salvata sul record, o ricavata dall'AI, o l'unica del profilo. */
export function cityOf(rec: StoredListing, p: Profile): string | null {
  if (rec.city) return rec.city;
  const fromAi = citySlugOf(rec.fields?.citta);
  if (fromAi) return fromAi;
  const cities = new Set(p.searches.map((s) => s.city));
  return cities.size === 1 ? [...cities][0]! : null;
}

function zonesFor(city: string | null, p: Profile): CityZones | undefined {
  return city ? p.zones.find((z) => z.city === city) : undefined;
}

const tipoLabel = (n: number): string => (n === 1 ? 'monolocale' : n === 2 ? 'bilocale' : n === 3 ? 'trilocale' : `${n} locali`);

/** La prima regola violata, nell'ordine in cui la spiegheresti a voce. */
export function checkRules(rec: StoredListing, p: Profile): Violation | null {
  const city = cityOf(rec, p);
  const searches = searchesFor(city, p);
  if (!searches.length) return null;
  const f = rec.fields;
  const tipologia = f?.tipologia ?? null;

  if (tipologia && NOT_RENTAL.test(tipologia)) {
    return { rule: 'tipo', reason: `${tipologia}: non è un affitto per viverci` };
  }

  if (!searches.some(wantsRooms) && isRoomOffer(tipologia, rec.listing.title)) {
    return { rule: 'stanza', reason: 'stanza in casa condivisa: cerchi una casa intera' };
  }

  const locali = f?.locali ?? rec.listing.rooms ?? null;
  const houses = searches.filter((s) => !wantsRooms(s));
  if (locali != null && houses.length && !houses.some((s) => s.minRooms == null && s.maxRooms == null)) {
    const ok = houses.some((s) => locali >= (s.minRooms ?? 1) && locali <= (s.maxRooms ?? Infinity));
    if (!ok) {
      const cercati = Array.from(new Set(houses.map((s) => s.label.split('·').pop()!.trim()))).join(' o ');
      return { rule: 'locali', reason: `${tipoLabel(locali)}: cerchi ${cercati}` };
    }
  }

  const price = rec.listing.price ?? f?.prezzo ?? null;
  const cap = Math.max(...searches.map((s) => s.maxPrice));
  if (price != null && Number.isFinite(cap) && price > cap) {
    return { rule: 'prezzo', reason: `${price} €: oltre il tetto di ${cap} €` };
  }

  const area = zonesFor(city, p)?.area?.polygon;
  if (area && area.length >= 3 && preciseEnough(rec.geo) && !insidePolygon(rec.geo, area)) {
    return { rule: 'area', reason: 'fuori dall\'area disegnata sulla mappa' };
  }

  return null;
}

/** Il motivo del conflitto da mostrare, corto: "solo studenti" più che una frase. */
function conflictReason(rec: StoredListing): string {
  const f = rec.fields;
  const m = f?.motivo_conflitto?.trim();
  if (m) return m;
  const v = f?.vincoli_inquilino?.filter(Boolean) ?? [];
  return v.length ? v.slice(0, 2).join(', ') : 'vincolo sull\'inquilino';
}

/**
 * Applica le regole a tutto l'archivio. Pura sul profilo, muta i record: va chiamata dentro
 * `store.mutateAndSave` (o prima di un save della pipeline).
 */
export function applyRules(records: Iterable<StoredListing>, p: Profile, nowIso: string): RulesResult {
  const out: RulesResult = { dismissed: 0, restored: 0, ask: 0 };
  const threshold = p.askThreshold ?? DEFAULT_ASK_THRESHOLD;

  for (const rec of records) {
    const managed = rec.status === 'new' || (rec.status === 'dismissed' && rec.auto != null);
    if (!managed) continue;

    let v = checkRules(rec, p);
    let ask: { reason: string } | null = null;
    if (!v && p.tenant && rec.fields?.conflitto_inquilino === 'si') {
      const reason = conflictReason(rec);
      if ((rec.ai?.score ?? 0) >= threshold) ask = { reason };
      else v = { rule: 'inquilino', reason };
    }

    if (v) {
      if (rec.status === 'new') out.dismissed++;
      rec.status = 'dismissed';
      rec.auto = { rule: v.rule, reason: v.reason, at: rec.auto?.rule === v.rule ? rec.auto.at : nowIso };
      delete rec.askOwner;
    } else {
      if (rec.status === 'dismissed') {
        rec.status = 'new';
        out.restored++;
      }
      delete rec.auto;
      if (ask) {
        rec.askOwner = ask;
        out.ask++;
      } else delete rec.askOwner;
    }
  }
  return out;
}
