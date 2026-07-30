import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseModelMeta,
  rankModels,
  sizeTier,
  recordPenalty,
  penaltyScore,
  clearPenalties,
  type ModelHealth,
} from '../src/ai/endpoint-health.js';

const H = (slug: string, over: Partial<ModelHealth> = {}): ModelHealth => ({
  slug,
  alive: true,
  uptime5m: 99,
  uptime30m: 99,
  throughput: 0,
  endpointCount: 1,
  ...over,
});
const map = (hs: ModelHealth[]) => new Map(hs.map((h) => [h.slug, h]));

// --- parseModelMeta ---
test('parseModelMeta: taglia/instruct/free dallo slug', () => {
  assert.deepEqual(parseModelMeta('nvidia/nemotron-3-ultra-550b-a55b:free'), { sizeB: 550, instruct: false, free: true });
  assert.deepEqual(parseModelMeta('google/gemma-4-26b-a4b-it:free'), { sizeB: 26, instruct: true, free: true });
  assert.deepEqual(parseModelMeta('openai/gpt-oss-120b:free'), { sizeB: 120, instruct: false, free: true });
  assert.equal(parseModelMeta('meta/llama-3.3-70b-instruct').instruct, true);
  assert.equal(parseModelMeta('vendor/mystery-model').sizeB, null);
});

// --- penalità ---
test('penalties: record/score/clear', () => {
  clearPenalties();
  assert.equal(penaltyScore('m'), 0);
  recordPenalty('m', 'length'); // 3
  recordPenalty('m', '429'); // +1
  assert.equal(penaltyScore('m'), 4);
  clearPenalties();
  assert.equal(penaltyScore('m'), 0);
});

// --- rankModels (ricetta) ---
test('rankModels: quality-floor esclude i toy (<26B) con taglia nota', () => {
  clearPenalties();
  const r = rankModels(['toy/x-7b:free', 'big/y-70b:free'], map([H('toy/x-7b:free'), H('big/y-70b:free')]));
  assert.deepEqual(r, ['big/y-70b:free']); // il 7b è un "toy" → fuori
});

test('rankModels: a parità di salute preferisce instruct (scavalca il seed)', () => {
  clearPenalties();
  const a = 'x/base-70b:free'; // seed 0, non-instruct
  const b = 'y/model-70b-it:free'; // seed 1, instruct
  assert.deepEqual(rankModels([a, b], map([H(a), H(b)])), [b, a]);
});

test('rankModels: il penalizzato sprofonda sotto il non-penalizzato', () => {
  clearPenalties();
  const a = 'x/model-70b-it:free';
  const b = 'y/model-70b-it:free';
  recordPenalty(a, 'length');
  assert.deepEqual(rankModels([a, b], map([H(a), H(b)])), [b, a]);
  clearPenalties();
});

test('rankModels: :free come tie-break tra pari', () => {
  clearPenalties();
  const paid = 'x/model-70b-it';
  const free = 'y/model-70b-it:free';
  assert.deepEqual(rankModels([paid, free], map([H(paid), H(free)])), [free, paid]);
});

test('rankModels: la salute domina la preferenza instruct (degrado grosso perde)', () => {
  clearPenalties();
  const healthyBase = 'x/base-70b:free'; // sano 99
  const degradedInstruct = 'y/model-70b-it:free'; // instruct ma degradato
  const hs = map([H(healthyBase, { uptime5m: 99 }), H(degradedInstruct, { uptime5m: 92 })]);
  // fasce diverse (step 2): 99→fascia0, 92→fascia3 → il sano vince nonostante non-instruct
  assert.deepEqual(rankModels([healthyBase, degradedInstruct], hs, { minUptime: 90, bandStep: 2 }), [
    healthyBase,
    degradedInstruct,
  ]);
});

// --- preferenza taglia (sweet-spot 26-40B, giganti fallback) ---
test('sizeTier: 26-40→0 · 41-80→1 · >80→2 · ignoto→1', () => {
  assert.equal(sizeTier(26), 0);
  assert.equal(sizeTier(31), 0);
  assert.equal(sizeTier(40), 0);
  assert.equal(sizeTier(70), 1);
  assert.equal(sizeTier(120), 2);
  assert.equal(sizeTier(550), 2);
  assert.equal(sizeTier(null), 1);
});

test('rankModels: lo sweet-spot 26B batte il gigante 550B (stessa salute, gigante seed-first)', () => {
  clearPenalties();
  const giant = 'nvidia/nemotron-3-ultra-550b:free'; // seed 0
  const sweet = 'google/gemma-4-26b-it:free'; // seed 1
  assert.deepEqual(rankModels([giant, sweet], map([H(giant), H(sweet)])), [sweet, giant]);
});

test('rankModels: il gigante diventa fallback quando lo sweet-spot è penalizzato', () => {
  clearPenalties();
  const sweet = 'google/gemma-4-26b-it:free';
  const giant = 'nvidia/nemotron-3-ultra-550b:free';
  recordPenalty(sweet, 'length');
  recordPenalty(sweet, 'length'); // sweet-spot bocciato empiricamente
  assert.deepEqual(rankModels([sweet, giant], map([H(sweet), H(giant)])), [giant, sweet]);
  clearPenalties();
});

test('rankModels: morto scartato · sconosciuto in coda · tutto-scartato→passthrough', () => {
  clearPenalties();
  const alive = 'a/x-70b:free';
  const dead = 'b/y-70b:free';
  const unk = 'c/z-70b:free';
  const hs = map([H(alive), H(dead, { alive: false, uptime5m: 0, endpointCount: 0 })]);
  assert.deepEqual(rankModels([dead, alive, unk], hs), [alive, unk]); // dead fuori, unk in coda
  // se tutti scartati → candidati invariati (fallback)
  const allDead = map([H(dead, { alive: false, uptime5m: 0 })]);
  assert.deepEqual(rankModels([dead], allDead), [dead]);
});
