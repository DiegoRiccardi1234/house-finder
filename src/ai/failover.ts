import { specOf } from './providers/catalog.js';
import { getProvider } from './providers/registry.js';
import type { ModelRef, ProviderId } from './providers/types.js';
import { refKey } from './providers/types.js';
import {
  noopProbe,
  openRouterProbe,
  penaltyScore,
  rankModels,
  type ModelHealth,
  type PickOptions,
} from './endpoint-health.js';
import { preferredModels, providerOrder } from './credentials.js';

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

async function rankedFor(
  id: ProviderId,
  task: 'reasoning' | 'vision',
  opts: PickOptions,
): Promise<string[]> {
  const spec = specOf(id);
  const pool = task === 'reasoning' ? spec.reasoning : spec.vision;
  const preferred = preferredModels()[task];
  let candidates = [...pool];
  if (preferred) candidates = [preferred, ...candidates.filter((m) => m !== preferred)];
  if (candidates.length === 0) {
    // Nessun pool statico (custom, o provider nuovo): si chiede la lista al provider.
    try {
      candidates = await getProvider(id).listModels();
    } catch {
      return [];
    }
  }
  const healths: Map<string, ModelHealth> = await probeFor(id).probe(candidates, opts);
  return rankModels(candidates, healths, {
    ...opts,
    // La penalità è per COPPIA provider+modello: lo stesso id su host diversi si comporta diversamente.
    penaltyOf: (slug) => penaltyScore(refKey({ provider: id, model: slug })),
  });
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
