import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateHealth,
  rankHealthy,
  fetchEndpointHealth,
  pickHealthyModels,
  clearHealthCache,
  type FetchFn,
  type ModelHealth,
} from '../src/ai/endpoint-health.js';

// --- Fixtures: payload reali (ridotti) da /endpoints ---
const ALIVE_1EP = { data: { endpoints: [{ status: 0, uptime_last_5m: 99.9, uptime_last_30m: 99.8 }] } };
const DEAD_0EP = { data: { endpoints: [] } }; // es. openai/gpt-oss-120b:free (morto)
const ALIVE_2EP = {
  data: {
    endpoints: [
      { status: 0, uptime_last_5m: 97.7, uptime_last_30m: 96.9 },
      { status: 0, uptime_last_5m: 100, uptime_last_30m: 98.9 },
    ],
  },
};
const MIXED = {
  data: {
    endpoints: [
      { status: 0, uptime_last_5m: 80, uptime_last_30m: 80 }, // vivo
      { status: 2, uptime_last_5m: 99, uptime_last_30m: 99 }, // giù → escluso dall'uptime
    ],
  },
};

// --- aggregateHealth (pura) ---
test('aggregateHealth: modello vivo con 1 endpoint', () => {
  const h = aggregateHealth('m', ALIVE_1EP);
  assert.equal(h.alive, true);
  assert.equal(h.uptime5m, 99.9);
  assert.equal(h.endpointCount, 1);
});

test('aggregateHealth: modello morto = 0 endpoint', () => {
  const h = aggregateHealth('m', DEAD_0EP);
  assert.equal(h.alive, false);
  assert.equal(h.uptime5m, 0);
  assert.equal(h.endpointCount, 0);
});

test('aggregateHealth: multi-endpoint prende il max uptime', () => {
  const h = aggregateHealth('m', ALIVE_2EP);
  assert.equal(h.alive, true);
  assert.equal(h.uptime5m, 100);
  assert.equal(h.endpointCount, 2);
});

test('aggregateHealth: gli endpoint con status!=0 non contano nell uptime ma nel count', () => {
  const h = aggregateHealth('m', MIXED);
  assert.equal(h.alive, true);
  assert.equal(h.uptime5m, 80); // solo l'endpoint vivo
  assert.equal(h.endpointCount, 2);
});

test('aggregateHealth: payload sporco/vuoto non lancia', () => {
  assert.equal(aggregateHealth('m', null).alive, false);
  assert.equal(aggregateHealth('m', {}).endpointCount, 0);
});

// --- rankHealthy (pura) ---
const H = (slug: string, alive: boolean, uptime5m: number, uptime30m = uptime5m): ModelHealth => ({
  slug,
  alive,
  uptime5m,
  uptime30m,
  throughput: 0,
  endpointCount: alive ? 1 : 0,
});

test('rankHealthy: scarta i morti e ordina i sani per uptime desc', () => {
  const healths = new Map([H('a', true, 99), H('b', false, 0), H('c', true, 95)].map((h) => [h.slug, h]));
  assert.deepEqual(rankHealthy(['a', 'b', 'c'], healths), ['a', 'c']);
});

test('rankHealthy: i candidati a salute sconosciuta restano in coda', () => {
  const healths = new Map([H('a', true, 99)].map((h) => [h.slug, h]));
  assert.deepEqual(rankHealthy(['a', 'b'], healths), ['a', 'b']); // b sconosciuto → coda
});

test('rankHealthy: soglia uptime esclude i sani troppo bassi', () => {
  const healths = new Map([H('a', true, 99), H('b', true, 50)].map((h) => [h.slug, h]));
  assert.deepEqual(rankHealthy(['a', 'b'], healths, { minUptime: 90 }), ['a']);
});

test('rankHealthy: risultato vuoto → passthrough dei candidati originali', () => {
  const healths = new Map([H('a', true, 50)].map((h) => [h.slug, h])); // sotto soglia, nessun unknown
  assert.deepEqual(rankHealthy(['a'], healths, { minUptime: 90 }), ['a']);
});

test('rankHealthy: nessuna salute nota (rete giù) → ordine invariato', () => {
  assert.deepEqual(rankHealthy(['a', 'b', 'c'], new Map()), ['a', 'b', 'c']);
});

// --- Bucketing: a parità di FASCIA vince la preferenza-pool (qualità), non l'uptime grezzo ---
test('rankHealthy: stessa fascia → vince la preferenza-pool anche con uptime minore', () => {
  // a=98.0 (seed 0, preferito), b=99.6 (seed 1). Con step 2 → stessa fascia (49).
  const healths = new Map([H('a', true, 98.0), H('b', true, 99.6)].map((h) => [h.slug, h]));
  assert.deepEqual(rankHealthy(['a', 'b'], healths, { minUptime: 90, bandStep: 2 }), ['a', 'b']);
});

test('rankHealthy: fascia diversa → vince l uptime più alto nonostante la preferenza-pool', () => {
  // a=91 (seed 0, preferito) fascia 45, b=99 (seed 1) fascia 49 → b scavalca.
  const healths = new Map([H('a', true, 91), H('b', true, 99)].map((h) => [h.slug, h]));
  assert.deepEqual(rankHealthy(['a', 'b'], healths, { minUptime: 90, bandStep: 2 }), ['b', 'a']);
});

// --- fetchEndpointHealth (I/O con fetch iniettato) ---
const okFetch = (payload: unknown): FetchFn => async () => ({ ok: true, json: async () => payload });

test('fetchEndpointHealth: risposta ok → ModelHealth', async () => {
  const h = await fetchEndpointHealth('m', okFetch(ALIVE_1EP));
  assert.equal(h?.alive, true);
  assert.equal(h?.uptime5m, 99.9);
});

test('fetchEndpointHealth: risposta non-ok → null', async () => {
  const h = await fetchEndpointHealth('m', async () => ({ ok: false, json: async () => ({}) }));
  assert.equal(h, null);
});

test('fetchEndpointHealth: fetch che lancia → null (mai eccezione)', async () => {
  const h = await fetchEndpointHealth('m', async () => {
    throw new Error('network down');
  });
  assert.equal(h, null);
});

// --- pickHealthyModels (integra fetch+rank, no rete reale) ---
function fixtureFetch(byLastSegment: Record<string, unknown>): FetchFn {
  return async (url: string) => {
    const slug = url.split('/models/')[1].replace('/endpoints', '');
    return { ok: true, json: async () => byLastSegment[slug] ?? DEAD_0EP };
  };
}

test('pickHealthyModels: scarta il morto; i sani near-equal restano in ordine-seed', async () => {
  clearHealthCache();
  const fetchFn = fixtureFetch({ alpha: ALIVE_1EP, dead: DEAD_0EP, beta: ALIVE_2EP });
  // alpha up5m 99.9, beta up5m 100 → stessa fascia (entro bandStep) → ordine-seed; dead scartato
  const chain = await pickHealthyModels(['alpha', 'dead', 'beta'], { fetchFn });
  assert.deepEqual(chain, ['alpha', 'beta']);
});

test('pickHealthyModels: tutti i fetch falliscono → candidati invariati', async () => {
  clearHealthCache();
  const fetchFn: FetchFn = async () => {
    throw new Error('down');
  };
  const chain = await pickHealthyModels(['x', 'y'], { fetchFn });
  assert.deepEqual(chain, ['x', 'y']);
});

test('pickHealthyModels: la cache evita un secondo fetch entro il TTL', async () => {
  clearHealthCache();
  let calls = 0;
  const fetchFn: FetchFn = async () => {
    calls++;
    return { ok: true, json: async () => ALIVE_1EP };
  };
  await pickHealthyModels(['cached'], { fetchFn, ttlMs: 60_000, now: () => 1000 });
  await pickHealthyModels(['cached'], { fetchFn, ttlMs: 60_000, now: () => 2000 });
  assert.equal(calls, 1);
});

test('pickHealthyModels: cache scaduta → rifetch', async () => {
  clearHealthCache();
  let calls = 0;
  const fetchFn: FetchFn = async () => {
    calls++;
    return { ok: true, json: async () => ALIVE_1EP };
  };
  await pickHealthyModels(['exp'], { fetchFn, ttlMs: 1000, now: () => 1000 });
  await pickHealthyModels(['exp'], { fetchFn, ttlMs: 1000, now: () => 5000 }); // oltre TTL
  assert.equal(calls, 2);
});
