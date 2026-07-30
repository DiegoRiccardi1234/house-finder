/**
 * Pool di modelli candidati per reasoning e vision (OpenRouter, free tier).
 *
 * L'ordine è la preferenza A PARITÀ di salute; la selezione health-aware
 * (`src/ai/endpoint-health.ts`) riordina/filtra in base allo stato live degli endpoint.
 * Gli override da .env (AI_MODEL / AI_MODEL_FALLBACK / VISION_MODEL) entrano in TESTA al
 * pool ma restano soggetti al filtro salute: un modello morto viene comunque scartato.
 */

/**
 * Reasoning: estrazione campi + voto (output JSON). Il ranking è TASK-AWARE (`rankModels` in
 * `endpoint-health.ts`): salute → quality-floor ~26B → instruct/non-reasoning → :free → velocità,
 * e i modelli che troncano/vuoto/429 vengono penalizzati sticky per il task (l'app si auto-corregge).
 * Per output JSON conviene aggiungere qui candidati **instruct ~26-40B** (dopo averli verificati con
 * `npm run try:health` + un `try:score` di troncamento): il ranking li preferirà ai giganti reasoning.
 */
export const REASONING_POOL: string[] = [
  'google/gemma-4-26b-a4b-it:free', // 26B instruct — sweet-spot JSON (citato nelle regole)
  'google/gemma-4-31b-it:free', // 31B instruct
  'nvidia/nemotron-3-nano-30b-a3b:free', // 30B non-reasoning
  'nvidia/nemotron-3-ultra-550b-a55b:free', // gigante — solo fallback (tende a troncare il JSON)
  'openai/gpt-oss-120b:free', // gigante — solo fallback (oggi morto)
];

/** Vision: descrizione foto. Il combo nemotron fa vision+reasoning in una chiamata. */
export const VISION_POOL: string[] = [
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
];

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

/** Candidati reasoning: override da env in testa, poi il pool. Deduplicati. */
export function reasoningCandidates(): string[] {
  return dedup([process.env.AI_MODEL, process.env.AI_MODEL_FALLBACK, ...REASONING_POOL]);
}

/** Candidati vision: override da env in testa, poi il pool. Deduplicati. */
export function visionCandidates(): string[] {
  return dedup([process.env.VISION_MODEL, ...VISION_POOL]);
}
