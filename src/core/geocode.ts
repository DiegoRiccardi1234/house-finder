import { readFile } from 'node:fs/promises';
import type { GeoPoint } from './types.js';
import { writeJsonAtomic } from './atomic.js';
import { APP_VERSION } from '../version.js';

/**
 * Da indirizzo a coordinate, con OpenStreetMap (Nominatim).
 *
 * Regole d'uso del servizio pubblico, rispettate qui e non altrove:
 * - al massimo **1 richiesta al secondo**, in fila;
 * - un User-Agent che identifica l'app (senza dati personali);
 * - **cache su disco**, anche dei risultati vuoti: lo stesso indirizzo non si chiede due volte.
 *
 * Non solleva mai: un indirizzo non trovato o un servizio giù lasciano l'annuncio "posizione da
 * verificare", che le regole non scartano.
 */

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const CACHE_PATH = process.env.GEOCACHE_PATH ?? 'state/geocache.json';

type FetchFn = typeof fetch;

interface CacheEntry { point: GeoPoint | null; at: string; v?: number }

export interface GeocodeOptions {
  fetchFn?: FetchFn;
  cachePath?: string;
  /** Attesa fra due richieste. Default 1100 ms (margine sul limite di 1/s). */
  delayMs?: number;
}

export interface GeocodeHit extends GeoPoint {
  label: string;
}

interface NominatimRow {
  lat: string;
  lon: string;
  display_name?: string;
  addresstype?: string;
  type?: string;
  class?: string;
}

const HEADERS = {
  'User-Agent': `HouseFinder/${APP_VERSION} (+https://github.com/DiegoRiccardi1234/house-finder)`,
  'Accept-Language': 'it',
};

/** Quanto è preciso un risultato di Nominatim. */
export function precisionOf(row: Pick<NominatimRow, 'addresstype' | 'type' | 'class'>): GeoPoint['precision'] {
  // Si guardano entrambi: per un civico interpolato Nominatim dà `addresstype: "place"` e
  // `type: "house"` (visto il 26/11 su "Via Cavour 10, Torino"), e leggere solo il primo lo
  // declassava a quartiere, sottraendolo alla regola dell'area.
  const ts = [row.addresstype, row.type].map((t) => (t ?? '').toLowerCase());
  if (ts.some((t) => ['house', 'building', 'house_number', 'amenity', 'shop', 'office'].includes(t))) return 'address';
  if (ts.some((t) => ['road', 'street', 'residential', 'pedestrian', 'square', 'tertiary', 'secondary', 'primary', 'living_street', 'unclassified'].includes(t))) return 'street';
  if (row.class === 'highway') return 'street';
  return 'zone';
}

/** Versione delle voci in cache: quelle "di quartiere" scritte prima del 1.9.2 vanno rifatte. */
const CACHE_V = 2;

let cache: Record<string, CacheEntry> | null = null;
let cacheFile = '';
let last = 0;
let chain: Promise<unknown> = Promise.resolve();

async function loadCache(path: string): Promise<Record<string, CacheEntry>> {
  if (cache && cacheFile === path) return cache;
  try {
    cache = JSON.parse(await readFile(path, 'utf8')) as Record<string, CacheEntry>;
  } catch {
    cache = {};
  }
  cacheFile = path;
  return cache;
}

/** Solo per i test: dimentica cache in memoria e ritmo. */
export function resetGeocoder(): void {
  cache = null;
  cacheFile = '';
  last = 0;
  chain = Promise.resolve();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Una richiesta alla volta, distanziate: la coda vale per tutta l'app. */
function throttled<T>(delayMs: number, work: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = last + delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      return await work();
    } finally {
      last = Date.now();
    }
  });
  chain = run.catch(() => {});
  return run;
}

async function query(params: Record<string, string>, opts: GeocodeOptions): Promise<NominatimRow[]> {
  const url = `${NOMINATIM_URL}?${new URLSearchParams({ format: 'jsonv2', countrycodes: 'it', ...params })}`;
  const fetchFn = opts.fetchFn ?? fetch;
  return throttled(opts.delayMs ?? 1100, async () => {
    const res = await fetchFn(url, { headers: HEADERS, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as NominatimRow[];
  });
}

/** Normalizza la chiave della cache: maiuscole, spazi e punteggiatura non contano. */
const keyOf = (q: string): string => q.toLowerCase().replace(/[^a-z0-9àèéìòù]+/g, ' ').trim();

/**
 * Cerca un indirizzo dentro una città. `bbox` = [sud, ovest, nord, est] facoltativo: se c'è, il
 * risultato deve cadere lì dentro (evita la "via Roma" di un'altra città).
 */
export async function geocodeAddress(
  address: string,
  cityLabel: string,
  bbox?: [number, number, number, number] | null,
  opts: GeocodeOptions = {},
): Promise<GeoPoint | null> {
  const q = `${address}, ${cityLabel}`;
  const path = opts.cachePath ?? CACHE_PATH;
  const store = await loadCache(path);
  const k = keyOf(q);
  const hit = store[k];
  // Una voce "di quartiere" della 1.9.0/1.9.1 può essere un civico classificato male: si rifà.
  if (hit && !(hit.point?.precision === 'zone' && (hit.v ?? 1) < CACHE_V)) return hit.point;

  let point: GeoPoint | null = null;
  try {
    const params: Record<string, string> = { q, limit: '1' };
    if (bbox) {
      const [s, w, n, e] = bbox;
      params.viewbox = `${w},${n},${e},${s}`;
      params.bounded = '1';
    }
    const rows = await query(params, opts);
    const row = rows[0];
    if (row) {
      const lat = Number(row.lat);
      const lng = Number(row.lon);
      if (Number.isFinite(lat) && Number.isFinite(lng)) point = { lat, lng, precision: precisionOf(row), source: 'geocode' };
    }
  } catch {
    // Servizio giù o lento: niente cache, si riprova alla prossima scansione.
    return null;
  }
  store[k] = { point, at: new Date().toISOString(), v: CACHE_V };
  await writeJsonAtomic(path, store).catch(() => {});
  return point;
}

const STREET_KW = /(?:^|[\s,(])(via|viale|corso|c\.so|piazza|piazzale|p\.zza|p\.za|largo|vicolo|strada|lungo\s?po|lungo\s?dora)\s+/i;
/** Parole da annuncio che chiudono il nome della via: «VIA GORIZIA DECOROSO E GRAZIOSO BILOCALE». */
const NOT_STREET = new Set(('monolocale bilocale trilocale quadrilocale alloggio appartamento casa attico mansarda loft stanza camera ' +
  'arredato arredata ammobiliato ammobiliata luminoso luminosa grazioso graziosa decoroso decorosa nuovo nuova ristrutturato ' +
  'ristrutturata spazioso spaziosa panoramico panoramica comodo comoda ampio ampia piccolo piccola bello bella bellissimo ' +
  'signorile elegante ottimo ottima libero libera subito zona vicino vicinanze con e in a al alla euro affitto affittasi ' +
  'mq piano box terrazzo terrazzino balcone torino ingresso cucina affittato disponibile'
).split(' '));
const PARTICLES = new Set(['di', 'da', 'del', 'della', 'dei', 'degli', 'delle', 'de', 'dello']);

/**
 * La via scritta in un titolo, quando l'AI non l'ha riportata: «CORSO TRAPANI ALLOGGIO CON BOX»
 * → «corso trapani». Prudente: si ferma alla prima virgola, a una parola da annuncio o dopo 4
 * parole, e tiene il civico solo se segue subito. `null` se non c'è una via riconoscibile.
 */
export function streetFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = STREET_KW.exec(text);
  if (!m) return null;
  const kw = m[1]!.toLowerCase().replace(/^c\.so$/, 'corso').replace(/^p\.z?za$/, 'piazza').replace(/\s+/g, '');
  const rest = text.slice(m.index + m[0].length);
  const words: string[] = [];
  let civico = '';
  for (const raw of rest.split(/\s+/)) {
    const comma = /[,;:|()\-–]$/.test(raw) || /^[,;:|()\-–]/.test(raw);
    const w = raw.replace(/[,;:|()\-–.]+/g, '').toLowerCase();
    if (!w) break;
    if (/^\d+[a-z]?(\/\d+)?$/.test(w)) { if (words.length) civico = w; break; }
    if (NOT_STREET.has(w)) break;
    words.push(w);
    if (comma || words.length >= 4) break;
  }
  // Una preposizione in coda non è un nome («via de» da «VIA DE GASPERI» tagliato non capita, ma prudenza).
  while (words.length && PARTICLES.has(words[words.length - 1]!)) words.pop();
  if (!words.length || words.every((w) => PARTICLES.has(w))) return null;
  // Titolo con «corso Spezia, 55»: il civico dopo la virgola.
  if (!civico) {
    const after = rest.match(new RegExp(`^${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')}\\s*,\\s*(\\d+[a-z]?)\\b`, 'i'));
    if (after) civico = after[1]!.toLowerCase();
  }
  return [kw, ...words, civico].filter(Boolean).join(' ');
}

const placesCache = new Map<string, GeocodeHit[]>();

/**
 * Ricerca libera per la UI (punto di riferimento, centro città): fino a 5 risultati, con
 * l'etichetta. Ricordata in memoria: riaprire la Config non rifà la stessa domanda.
 */
export async function searchPlaces(text: string, opts: GeocodeOptions = {}): Promise<GeocodeHit[]> {
  const q = text.trim().slice(0, 200);
  if (q.length < 3) return [];
  const k = keyOf(q);
  const hit = placesCache.get(k);
  if (hit) return hit;
  try {
    const rows = await query({ q, limit: '5' }, opts);
    const out = rows
      .map((r) => ({ lat: Number(r.lat), lng: Number(r.lon), precision: precisionOf(r), source: 'geocode' as const, label: r.display_name ?? q }))
      .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
    if (placesCache.size > 200) placesCache.clear();
    placesCache.set(k, out);
    return out;
  } catch {
    return [];
  }
}

/** Il riquadro che contiene un poligono, allargato di `marginKm` per lato. */
export function bboxOf(polygon: [number, number][], marginKm = 3): [number, number, number, number] | null {
  if (polygon.length < 3) return null;
  const lats = polygon.map((p) => p[0]);
  const lngs = polygon.map((p) => p[1]);
  const dLat = marginKm / 111;
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const dLng = marginKm / (111 * Math.cos((midLat * Math.PI) / 180));
  return [Math.min(...lats) - dLat, Math.min(...lngs) - dLng, Math.max(...lats) + dLat, Math.max(...lngs) + dLng];
}
