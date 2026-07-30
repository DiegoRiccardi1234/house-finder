import 'dotenv/config';
import {
  fetchEndpointHealth,
  rankHealthy,
  rankModels,
  parseModelMeta,
  type ModelHealth,
} from '../src/ai/endpoint-health.js';
import { reasoningCandidates, visionCandidates } from '../src/config/models.js';

/**
 * Diagnostica salute + ranking modelli (AI-free, NON consuma quota: solo /endpoints).
 * Reasoning = ranking TASK-AWARE (salute + quality-floor + instruct + :free + velocità).
 * Vision = ranking salute semplice.
 *   npm run try:health
 */

function fmt(slug: string, h: ModelHealth | null): string {
  const m = parseModelMeta(slug);
  const meta = `${m.sizeB ?? '?'}B ${m.instruct ? 'instruct' : 'base'}${m.free ? ' free' : ''}`;
  if (!h) return `  ${slug.padEnd(52)} ?       (fetch fallito)          [${meta}]`;
  const state = h.alive ? 'VIVO ' : 'MORTO';
  return `  ${slug.padEnd(52)} ${state}  up5m=${h.uptime5m.toFixed(1).padStart(5)}  thr=${h.throughput.toFixed(0).padStart(4)}  ep=${h.endpointCount}  [${meta}]`;
}

async function report(label: string, candidates: string[], taskAware: boolean): Promise<string[]> {
  console.log(`\n=== ${label} ===`);
  const healths = new Map<string, ModelHealth>();
  for (const slug of candidates) {
    const h = await fetchEndpointHealth(slug);
    if (h) healths.set(slug, h);
    console.log(fmt(slug, h));
  }
  return taskAware ? rankModels(candidates, healths) : rankHealthy(candidates, healths);
}

async function main(): Promise<void> {
  const rChain = await report('Reasoning (task-aware: JSON/scoring)', reasoningCandidates(), true);
  console.log('  → catena scelta:', rChain.join('  >  '));

  const vChain = await report('Vision (salute)', visionCandidates(), false);
  console.log('  → modello scelto:', vChain[0] ?? '(nessuno)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
