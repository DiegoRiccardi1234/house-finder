import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFailoverChain } from '../src/ai/failover.js';
import { refKey } from '../src/ai/providers/types.js';

test('catena: prima K modelli del primario, poi uno per ogni altro provider', () => {
  const chain = buildFailoverChain({
    order: ['openrouter', 'groq', 'cerebras'],
    ranked: {
      openrouter: ['a', 'b', 'c', 'd'],
      groq: ['g1', 'g2'],
      cerebras: ['c1'],
    },
    intraProviderK: 3,
  });

  const asText = chain.map(refKey);
  assert.deepEqual(asText.slice(0, 3), ['openrouter::a', 'openrouter::b', 'openrouter::c']);
  assert.deepEqual(asText.slice(3, 5), ['groq::g1', 'cerebras::c1']);
  // Il resto del primario resta in coda: si usa solo se tutto il resto ha fallito.
  assert.equal(asText[5], 'openrouter::d');
});

test('catena: nessun duplicato quando lo stesso id vive su più host', () => {
  const chain = buildFailoverChain({
    order: ['groq', 'cerebras'],
    ranked: { groq: ['llama-3.3-70b', 'llama-3.3-70b'], cerebras: ['llama-3.3-70b'] },
    intraProviderK: 2,
  });
  const keys = chain.map(refKey);
  assert.equal(new Set(keys).size, keys.length, 'coppie duplicate nella catena');
  // Stesso nome su host diversi NON è un duplicato: sono due candidati distinti.
  assert.deepEqual(keys, ['groq::llama-3.3-70b', 'cerebras::llama-3.3-70b']);
});

test('catena: provider senza modelli viene saltato, non blocca', () => {
  const chain = buildFailoverChain({
    order: ['openrouter', 'groq'],
    ranked: { openrouter: [], groq: ['g1'] },
  });
  assert.deepEqual(chain.map(refKey), ['groq::g1']);
});

test('catena vuota se non c’è nulla da provare', () => {
  assert.deepEqual(buildFailoverChain({ order: [], ranked: {} }), []);
});
