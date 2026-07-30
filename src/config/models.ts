/**
 * Pool di modelli candidati, per provider.
 *
 * La lista vive nel catalogo (`src/ai/providers/catalog.ts`), che è anche ciò che l'API
 * serve alla UI: una sola fonte di verità invece di due liste da tenere allineate.
 *
 * L'ordine è la preferenza A PARITÀ di salute; il ranking task-aware
 * (`src/ai/endpoint-health.ts`) riordina e filtra in base allo stato live degli endpoint
 * (dove il provider lo pubblica) e alle penalità empiriche accumulate.
 */
import { CATALOG, specOf } from '../ai/providers/catalog.js';
import { preferredModels, primaryProvider } from '../ai/credentials.js';
import type { ProviderId } from '../ai/providers/types.js';

export interface ModelPool {
  reasoning: string[];
  vision: string[];
}

export const POOLS: Record<ProviderId, ModelPool> = Object.fromEntries(
  CATALOG.map((s) => [s.id, { reasoning: s.reasoning, vision: s.vision }]),
) as Record<ProviderId, ModelPool>;

function dedup(models: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of models) {
    if (!m || seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
  return out;
}

/** Candidati reasoning del provider indicato (default: il primario). Preferenza in testa. */
export function reasoningCandidates(provider?: ProviderId): string[] {
  const id = provider ?? primaryProvider();
  return dedup([preferredModels().reasoning, ...specOf(id).reasoning]);
}

/** Candidati vision del provider indicato (default: il primario). Preferenza in testa. */
export function visionCandidates(provider?: ProviderId): string[] {
  const id = provider ?? primaryProvider();
  return dedup([preferredModels().vision, ...specOf(id).vision]);
}
