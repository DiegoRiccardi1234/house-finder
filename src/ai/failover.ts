import { specOf } from './providers/catalog.js';
import { getProvider } from './providers/registry.js';
import type { ModelRef, ProviderId } from './providers/types.js';
import { refKey } from './providers/types.js';
import {
  noopProbe,
  openRouterProbe,
  parseModelMeta,
  penaltyScore,
  rankModels,
  type ModelHealth,
  type PickOptions,
} from './endpoint-health.js';
import { preferredModels, primaryProvider, providerOrder } from './credentials.js';

/** Quanti modelli provare sullo stesso host prima di cambiare provider. */
const INTRA_PROVIDER = 3;

export interface ChainInput {
  order: ProviderId[];
  /** Candidati già ordinati, per provider. */
  ranked: Partial<Record<ProviderId, string[]>>;
  intraProviderK?: number;
}

/**
 * Pura. Costruisce la catena di failover: **prima K modelli dello stesso provider**, poi uno
 * per ciascun altro provider configurato.
 *
 * L'ordine conta: con un solo modello per provider, un `:free` in 429 esaurisce subito l'host
 * migliore; ruotando prima su un altro modello dello stesso host si resta dove la qualità è
 * quella scelta.
 */
export function buildFailoverChain(input: ChainInput): ModelRef[] {
  const k = input.intraProviderK ?? INTRA_PROVIDER;
  const out: ModelRef[] = [];
  const seen = new Set<string>();
  const push = (provider: ProviderId, model: string) => {
    const ref = { provider, model };
    const key = refKey(ref);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(ref);
  };

  const [primary, ...rest] = input.order;
  if (primary) for (const m of (input.ranked[primary] ?? []).slice(0, k)) push(primary, m);
  for (const p of rest) {
    const first = (input.ranked[p] ?? [])[0];
    if (first) push(p, first);
  }
  // Coda: il resto dei modelli del primario, se la catena si esaurisce.
  if (primary) for (const m of (input.ranked[primary] ?? []).slice(k)) push(primary, m);
  return out;
}

function probeFor(id: ProviderId) {
  return specOf(id).caps.health === 'openrouter' ? openRouterProbe : noopProbe;
}

/**
 * Mette il modello scelto a mano davvero in testa.
 *
 * `rankModels` non si limita a riordinare: **scarta** chi ha salute sotto soglia o taglia sotto
 * il quality-floor. Quindi limitarsi a passarglielo per primo non basta — un modello scelto
 * dall'utente poteva sparire dalla catena senza che nessuno lo dicesse, e la UI avrebbe mostrato
 * una scelta che il motore ignorava.
 *
 * Una scelta esplicita vale più di un'euristica: si rimette in posizione 0. Se poi il modello
 * rifiuta davvero, il failover prosegue sugli altri come sempre — il pin decide da dove si parte,
 * non che ci si debba schiantare lì.
 */
function pinFirst(ranked: string[], pinned: string | undefined): string[] {
  if (!pinned) return ranked;
  return [pinned, ...ranked.filter((m) => m !== pinned)];
}

/** Il modello scelto a mano vale per il provider primario: è lì che l'utente l'ha scelto. */
function pinnedFor(id: ProviderId, task: 'reasoning' | 'vision'): string | undefined {
  return id === primaryProvider() ? preferredModels()[task] : undefined;
}

async function rankedFor(
  id: ProviderId,
  task: 'reasoning' | 'vision',
  opts: PickOptions,
): Promise<string[]> {
  const spec = specOf(id);
  const pool = task === 'reasoning' ? spec.reasoning : spec.vision;
  const pinned = pinnedFor(id, task);
  let candidates = [...pool];
  if (pinned) candidates = [pinned, ...candidates.filter((m) => m !== pinned)];
  if (candidates.length === 0) {
    // Nessun pool statico (custom, o provider nuovo): si chiede la lista al provider.
    try {
      candidates = await getProvider(id).listModels();
    } catch {
      return [];
    }
  }
  const healths: Map<string, ModelHealth> = await probeFor(id).probe(candidates, opts);
  const ranked = rankModels(candidates, healths, {
    ...opts,
    // La penalità è per COPPIA provider+modello: lo stesso id su host diversi si comporta diversamente.
    penaltyOf: (slug) => penaltyScore(refKey({ provider: id, model: slug })),
  });
  return pinFirst(ranked, pinned);
}

export interface ModelChoice {
  id: string;
  /** È sopravvissuto ai filtri del ranking: salute, quality-floor, non-reasoning. */
  recommended: boolean;
  free: boolean;
  /** `null` quando il provider non pubblica la salute (tutti tranne OpenRouter). */
  uptime5m: number | null;
  penalty: number;
}

export interface TaskModels {
  /** Il modello fissato a mano, o `null` se si va in automatico. */
  pinned: string | null;
  /**
   * Chi verrebbe scelto **senza** il pin. Si calcola sempre, anche quando un pin c'è: è il
   * modello su cui si ripiega, ed è ciò che rende leggibile la voce "Automatico".
   */
  auto: string | null;
  /** Prima i consigliati nell'ordine del ranking, poi gli scartati. */
  candidates: ModelChoice[];
}

/** Il quadro completo per un compito: cosa c'è, cosa sceglierebbe da solo, cosa hai scelto tu. */
export async function modelsForTask(
  task: 'reasoning' | 'vision',
  opts: PickOptions = {},
): Promise<TaskModels> {
  const id = primaryProvider();
  const spec = specOf(id);
  const pinned = preferredModels()[task] ?? null;
  let pool = [...(task === 'reasoning' ? spec.reasoning : spec.vision)];
  if (pool.length === 0) {
    try {
      pool = await getProvider(id).listModels();
    } catch {
      pool = [];
    }
  }
  if (pool.length === 0) return { pinned, auto: null, candidates: [] };

  const healths = await probeFor(id).probe(pool, opts);
  const penaltyOf = (slug: string): number => penaltyScore(refKey({ provider: id, model: slug }));
  const ranked = rankModels(pool, healths, { ...opts, penaltyOf });
  // "Consigliati" = i primi tre della catena. Dove la salute non si pubblica (nove provider su
  // undici) il ranking coincide con l'ordine curato del catalogo, che è comunque una raccomandazione
  // vera; marcarne uno solo renderebbe il gruppo inutile, marcarli tutti lo renderebbe una bugia.
  const consigliati = new Set(ranked.slice(0, 3));

  const choice = (m: string): ModelChoice => ({
    id: m,
    recommended: consigliati.has(m),
    free: parseModelMeta(m).free,
    uptime5m: healths.get(m)?.uptime5m ?? null,
    penalty: penaltyOf(m),
  });

  const ordinati = [...ranked, ...pool.filter((m) => !ranked.includes(m))];
  return { pinned, auto: ranked[0] ?? null, candidates: ordinati.map(choice) };
}

/**
 * Catena di failover pronta all'uso per il task richiesto.
 * Se tutto risulta penalizzato la catena si ricostruisce ignorando le penalità: un modello
 * penalizzato è comunque meglio di "nessun provider disponibile".
 */
export async function buildChainForTask(
  task: 'reasoning' | 'vision',
  opts: PickOptions = {},
): Promise<ModelRef[]> {
  const order = providerOrder().filter((id) => (task === 'vision' ? specOf(id).caps.vision : true));
  const ranked: Partial<Record<ProviderId, string[]>> = {};
  for (const id of order) ranked[id] = await rankedFor(id, task, opts);
  const chain = buildFailoverChain({ order, ranked });
  if (chain.length > 0) return chain;

  const fallback: Partial<Record<ProviderId, string[]>> = {};
  for (const id of order) {
    const spec = specOf(id);
    fallback[id] = task === 'reasoning' ? spec.reasoning : spec.vision;
  }
  return buildFailoverChain({ order, ranked: fallback });
}
