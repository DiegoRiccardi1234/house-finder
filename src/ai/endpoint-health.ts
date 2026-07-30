/**
 * Selezione modelli HEALTH-AWARE (OpenRouter).
 *
 * Prima di usare un modello consulta la salute live pubblicata:
 *   GET https://openrouter.ai/api/v1/models/{slug}/endpoints
 * È GRATIS e non richiede auth → NON consuma la quota free (1000 req/giorno).
 * Per gli slug ":free" ritorna solo gli endpoint free (pricing 0).
 *
 * Comportamento: scarta i modelli morti (0 endpoint vivi / status != 0), ordina i sani
 * per uptime, tiene in coda i candidati a salute sconosciuta (fetch fallito). Fallback
 * silenzioso: qualunque errore → nessuna eccezione, si usa la lista statica dei candidati.
 *
 * Nota API: `latency_last_30m` sui free è quasi sempre `null` (NON è un dict di percentili),
 * quindi l'ordinamento usa `uptime_last_5m` (poi `uptime_last_30m`).
 */

const BASE = 'https://openrouter.ai/api/v1/models';
const DEFAULT_MIN_UPTIME = Number(process.env.AI_HEALTH_MIN_UPTIME ?? 90);
const DEFAULT_BAND_STEP = Number(process.env.AI_HEALTH_BAND ?? 2);
const DEFAULT_TTL_MS = Number(process.env.AI_HEALTH_TTL_MS ?? 5 * 60 * 1000);
const CONCURRENCY = 3;

export interface ModelHealth {
  slug: string;
  /** Almeno un endpoint con `status === 0`. */
  alive: boolean;
  /** Max `uptime_last_5m` tra gli endpoint vivi (0 se nessuno). */
  uptime5m: number;
  /** Max `uptime_last_30m` tra gli endpoint vivi (0 se nessuno). */
  uptime30m: number;
  /** Max `throughput_last_30m` tra gli endpoint vivi (0 se sconosciuto — spesso null sui free). */
  throughput: number;
  /** Numero totale di endpoint free ritornati (0 = modello morto/deprecato). */
  endpointCount: number;
}

interface RawEndpoint {
  status?: number;
  uptime_last_5m?: number | null;
  uptime_last_30m?: number | null;
  throughput_last_30m?: number | null;
}
interface EndpointsPayload {
  data?: { endpoints?: RawEndpoint[] };
}

/** Minimo comune denominatore di una Response, così i test possono iniettare un fake. */
export type FetchFn = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

function num(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Pura: aggrega il payload di /endpoints in una salute sintetica. */
export function aggregateHealth(slug: string, payload: unknown): ModelHealth {
  const eps = (payload as EndpointsPayload)?.data?.endpoints ?? [];
  const live = eps.filter((e) => e?.status === 0);
  const up5 = live.map((e) => num(e.uptime_last_5m));
  const up30 = live.map((e) => num(e.uptime_last_30m));
  const thr = live.map((e) => num(e.throughput_last_30m));
  return {
    slug,
    alive: live.length > 0,
    uptime5m: up5.length ? Math.max(...up5) : 0,
    uptime30m: up30.length ? Math.max(...up30) : 0,
    throughput: thr.length ? Math.max(...thr) : 0,
    endpointCount: eps.length,
  };
}

// --- Metadati dallo slug + penalità empiriche (regole CLAUDE.md §73-89) ---

export interface ModelMeta {
  /** Taglia in miliardi di parametri estratta dallo slug (null se non deducibile). */
  sizeB: number | null;
  /** Instruction-tuned (preferito per output JSON: no chain-of-thought che tronca). */
  instruct: boolean;
  /** Variante `:free`. */
  free: boolean;
}

/** Pura: deduce taglia/instruct/free dallo slug. NB: i nomi NON dicono se è reasoning (si impara dal runtime). */
export function parseModelMeta(slug: string): ModelMeta {
  const m = slug.match(/(\d+(?:\.\d+)?)\s*b(?![a-z])/i); // prima "<num>b" (es. 26b, 120b, 550b)
  return {
    sizeB: m ? Number(m[1]) : null,
    instruct: /instruct|-it(?:[:@-]|$)|chat/i.test(slug),
    free: /:free\b/i.test(slug),
  };
}

/**
 * Fascia di taglia per output JSON (lower = meglio). Sweet-spot 26-40B (veloce e capace);
 * i giganti (>80B) troncano → in fondo ma non esclusi (fallback). Taglia ignota = neutra.
 */
export function sizeTier(sizeB: number | null): number {
  if (sizeB == null) return 1;
  if (sizeB <= 40) return 0; // sweet-spot (il floor <26 è già filtrato a monte)
  if (sizeB <= 80) return 1; // grande ma accettabile
  return 2; // gigante: deprioritizzato
}

export type PenaltyReason = 'length' | 'empty' | 'malformed' | '429' | '403' | 'timeout' | 'json_fail';

/**
 * Peso e durata della penalità dipendono da **cosa** è andato storto:
 * un troncamento è strutturale (quel modello con quel prompt tronca sempre, ritentarlo
 * brucia quota), un 429 è transitorio (il throttle passa). Prima scadevano tutte insieme
 * solo a fine run.
 */
const PENALTY: Record<PenaltyReason, { weight: number; ttlMs: number }> = {
  length: { weight: 3, ttlMs: 60 * 60_000 },
  malformed: { weight: 3, ttlMs: 60 * 60_000 },
  empty: { weight: 3, ttlMs: 3 * 60_000 },
  json_fail: { weight: 3, ttlMs: 3 * 60_000 },
  timeout: { weight: 2, ttlMs: 15 * 60_000 },
  '429': { weight: 1, ttlMs: 5 * 60_000 },
  '403': { weight: 1, ttlMs: 5 * 60_000 },
};

interface PenaltyEntry {
  weight: number;
  reason: PenaltyReason;
  expiresAt: number;
}
const penalties = new Map<string, PenaltyEntry[]>();

/** Orologio iniettabile: i test sui cooldown non possono aspettare un'ora. */
let now: () => number = () => Date.now();
export function setPenaltyClock(fn: () => number): void {
  now = fn;
}

/** Registra una penalità empirica per un modello. La chiave può essere `provider::model`. */
export function recordPenalty(slug: string, reason: PenaltyReason): void {
  const { weight, ttlMs } = PENALTY[reason];
  const list = penalties.get(slug) ?? [];
  list.push({ weight, reason, expiresAt: now() + ttlMs });
  penalties.set(slug, list);
}

export function penaltyScore(slug: string): number {
  const list = penalties.get(slug);
  if (!list) return 0;
  const t = now();
  let sum = 0;
  let alive = 0;
  for (const p of list) {
    if (p.expiresAt > t) {
      sum += p.weight;
      alive++;
    }
  }
  if (alive === 0) penalties.delete(slug);
  return sum;
}

/** Azzera le penalità: tutte, o solo quelle di un motivo (a inizio run si scordano i troncamenti). */
export function clearPenalties(reason?: PenaltyReason): void {
  if (!reason) {
    penalties.clear();
    return;
  }
  for (const [slug, list] of penalties) {
    const kept = list.filter((p) => p.reason !== reason);
    if (kept.length) penalties.set(slug, kept);
    else penalties.delete(slug);
  }
}

export interface RankOptions {
  /** % `uptime_last_5m` minima per considerare sano un modello (default 90). */
  minUptime?: number;
  /**
   * Ampiezza (in punti di uptime %) della fascia entro cui la salute è "equivalente":
   * a parità di fascia vince la preferenza-pool (ordine-seed), non l'uptime grezzo. Default 2.
   */
  bandStep?: number;
  /** Quality-floor: taglia minima in B per non essere un "toy" (default 26). Solo se la taglia è nota. */
  minSizeB?: number;
  /**
   * Da dove leggere la penalità di un candidato. Serve col multi-provider: lo stesso id
   * (`llama-3.3-70b`) vive su host diversi e va penalizzato per coppia, non per nome.
   * `rankModels` resta così puro e mono-provider.
   */
  penaltyOf?: (slug: string) => number;
}

/**
 * Pura: riordina i candidati in base alla salute nota, con BUCKETING a fasce **relative al migliore**.
 *  - Sani (`alive && uptime5m >= minUptime`) in cima. Fascia = `floor((best - uptime5m) / bandStep)`
 *    dove `best` = uptime del sano migliore. Ordina per fascia asc (più vicini al best prima) →
 *    a parità di fascia **ordine-seed** (preferenza-pool/qualità). Chi è entro `bandStep` dal best
 *    è equivalente: vince la preferenza. Un degrado grosso finisce in una fascia peggiore e perde.
 *    (Fasce relative al best → nessun artefatto di bordo tipo 99.9 vs 100.0.)
 *  - Candidati a salute SCONOSCIUTA (nessuna entry in `healths`): tenuti in coda, ordine-seed.
 *  - Candidati NOTI ma non-sani (morti / sotto soglia): scartati.
 *  - Se il risultato è vuoto → ritorna i candidati originali invariati (fallback totale).
 */
export function rankHealthy(
  candidates: string[],
  healths: Map<string, ModelHealth>,
  opts: RankOptions = {},
): string[] {
  const minUptime = opts.minUptime ?? DEFAULT_MIN_UPTIME;
  const bandStep = opts.bandStep ?? DEFAULT_BAND_STEP;
  const seedIndex = new Map(candidates.map((c, i) => [c, i] as const));

  const healthy: string[] = [];
  const unknown: string[] = [];
  for (const c of candidates) {
    const h = healths.get(c);
    if (!h) {
      unknown.push(c); // salute sconosciuta → non scartare, tieni in coda
    } else if (h.alive && h.uptime5m >= minUptime) {
      healthy.push(c);
    }
    // altrimenti: noto e non-sano → scarta
  }

  const best = healthy.reduce((m, c) => Math.max(m, healths.get(c)!.uptime5m), 0);
  // Distanza dal migliore, in fasce di ampiezza bandStep (bandStep<=0 → fasce continue = puro uptime).
  const tier = (u: number): number => (bandStep > 0 ? Math.floor((best - u) / bandStep) : best - u);
  healthy.sort((a, b) => {
    const ta = tier(healths.get(a)!.uptime5m);
    const tb = tier(healths.get(b)!.uptime5m);
    if (ta !== tb) return ta - tb; // fascia più vicina al best prima
    return seedIndex.get(a)! - seedIndex.get(b)!; // stessa fascia → preferenza-pool
  });

  const ranked = [...healthy, ...unknown];
  return ranked.length ? ranked : candidates;
}

/**
 * Pura: ranking TASK-AWARE per output JSON/scoring (regole CLAUDE.md §73-89). Rispetto a
 * `rankHealthy` aggiunge, in ordine di priorità:
 *  1. **penalità empiriche** (tronca/vuoto/429): i penalizzati sprofondano (empirico > per-nome);
 *  2. **salute** a fasce (come rankHealthy);
 *  3. **quality-floor ~26B**: i "toy" con taglia nota < minSizeB sono scartati;
 *  4. **instruct/non-reasoning** preferito (i reasoning bruciano token → JSON troncato);
 *  5. **`:free`** come tie-break;
 *  6. il **più veloce** tra i capaci (`throughput`, spesso 0 sui free);
 *  7. **ordine-seed** (preferenza-pool).
 * Candidati a salute sconosciuta in coda; se tutto viene scartato → candidati invariati (fallback).
 */
export function rankModels(candidates: string[], healths: Map<string, ModelHealth>, opts: RankOptions = {}): string[] {
  const minUptime = opts.minUptime ?? DEFAULT_MIN_UPTIME;
  const bandStep = opts.bandStep ?? DEFAULT_BAND_STEP;
  const minSizeB = opts.minSizeB ?? 26;
  const seedIndex = new Map(candidates.map((c, i) => [c, i] as const));

  const eligible: string[] = [];
  const unknown: string[] = [];
  for (const c of candidates) {
    const h = healths.get(c);
    if (!h) {
      unknown.push(c);
      continue;
    }
    if (!(h.alive && h.uptime5m >= minUptime)) continue; // morto/degradato → scarta
    const meta = parseModelMeta(c);
    if (meta.sizeB != null && meta.sizeB < minSizeB) continue; // quality-floor: niente toy
    eligible.push(c);
  }

  const best = eligible.reduce((m, c) => Math.max(m, healths.get(c)!.uptime5m), 0);
  const tier = (u: number): number => (bandStep > 0 ? Math.floor((best - u) / bandStep) : best - u);
  const penaltyOf = opts.penaltyOf ?? penaltyScore;
  const key = (s: string): number[] => {
    const h = healths.get(s)!;
    const meta = parseModelMeta(s);
    return [
      penaltyOf(s), // 1. penalizzati in fondo (empirico > per-nome)
      tier(h.uptime5m), // 2. salute (fascia)
      sizeTier(meta.sizeB), // 3. taglia: sweet-spot 26-40B, giganti in fondo (proxy velocità sul free)
      meta.instruct ? 0 : 1, // 4. instruct/non-reasoning preferito
      meta.free ? 0 : 1, // 5. :free tie-break
      -h.throughput, // 6. più veloce (spesso 0 sui free)
      seedIndex.get(s)!, // 7. preferenza-pool
    ];
  };
  eligible.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return 0;
  });

  const ranked = [...eligible, ...unknown];
  return ranked.length ? ranked : candidates;
}

/** I/O: interroga /endpoints per uno slug. Timeout 5s (un fetch appeso non deve bloccare il run). Mai lancia. */
export async function fetchEndpointHealth(
  slug: string,
  fetchFn: FetchFn = (url) => fetch(url, { signal: AbortSignal.timeout(5000) }),
): Promise<ModelHealth | null> {
  try {
    const res = await fetchFn(`${BASE}/${slug}/endpoints`);
    if (!res.ok) return null;
    const payload = await res.json();
    return aggregateHealth(slug, payload);
  } catch {
    return null;
  }
}

export interface PickOptions extends RankOptions {
  /** TTL cache salute in ms (default 5 min). */
  ttlMs?: number;
  /** Fetch iniettabile (test). */
  fetchFn?: FetchFn;
  /** Clock iniettabile (test). */
  now?: () => number;
}

interface CacheEntry {
  health: ModelHealth;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();

/** Svuota la cache salute (usato dai test). */
export function clearHealthCache(): void {
  cache.clear();
}

/** Salute dei candidati (cache per-slug con TTL, fetch concorrente bounded). Mai lancia. */
async function fetchHealths(candidates: string[], opts: PickOptions): Promise<Map<string, ModelHealth>> {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const now = opts.now ?? (() => Date.now());

  const healths = new Map<string, ModelHealth>();
  const toFetch: string[] = [];
  for (const slug of candidates) {
    const hit = cache.get(slug);
    if (hit && hit.expiresAt > now()) healths.set(slug, hit.health);
    else toFetch.push(slug);
  }

  for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
    const batch = toFetch.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((slug) => fetchEndpointHealth(slug, opts.fetchFn).then((h) => ({ slug, h }))),
    );
    for (const { slug, h } of results) {
      if (h) {
        healths.set(slug, h);
        cache.set(slug, { health: h, expiresAt: now() + ttlMs });
      }
    }
  }
  return healths;
}

/**
 * Ritorna i candidati riordinati per SALUTE live (sani in cima, morti scartati). Semplice —
 * per task non-JSON (es. vision). Cache per-slug con TTL, fetch a concorrenza limitata. Mai lancia.
 */
export async function pickHealthyModels(candidates: string[], opts: PickOptions = {}): Promise<string[]> {
  return rankHealthy(candidates, await fetchHealths(candidates, opts), opts);
}

/**
 * Ritorna i candidati riordinati per la ricetta TASK-AWARE (output JSON/scoring): salute +
 * quality-floor + instruct-pref + penalità empiriche + :free + velocità. Vedi `rankModels`.
 */
export async function pickModelsForTask(candidates: string[], opts: PickOptions = {}): Promise<string[]> {
  return rankModels(candidates, await fetchHealths(candidates, opts), opts);
}

/**
 * La salute pubblicata è una peculiarità di OpenRouter: nessun altro provider espone
 * `/models/{slug}/endpoints`. Dietro questa interfaccia, gli altri usano una sonda vuota —
 * che è sicura per costruzione: con una mappa vuota tutti i candidati finiscono in "salute
 * sconosciuta", quindi restano nell'ordine-seed e il ranking degrada a preferenza-pool.
 */
export interface HealthProbe {
  probe(slugs: string[], opts?: PickOptions): Promise<Map<string, ModelHealth>>;
}

export const openRouterProbe: HealthProbe = {
  probe: (slugs, opts = {}) => fetchHealths(slugs, opts),
};

export const noopProbe: HealthProbe = {
  probe: async () => new Map<string, ModelHealth>(),
};
