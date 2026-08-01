import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EmptyCompletionError,
  TruncatedCompletionError,
  InvalidKeyError,
  classifyFailure,
  firstChoice,
  normalizeFinish,
} from '../src/ai/providers/errors.js';
import { createAnthropicProvider } from '../src/ai/providers/anthropic.js';

test('firstChoice: un payload rotto diventa errore classificato, non TypeError', () => {
  assert.throws(() => firstChoice({ choices: null }, 'm'), EmptyCompletionError);
  assert.throws(() => firstChoice({}, 'm'), EmptyCompletionError);
  assert.throws(() => firstChoice({ choices: [] }, 'm'), EmptyCompletionError);
  assert.throws(() => firstChoice({ choices: [{ message: { content: '   ' } }] }, 'm'), EmptyCompletionError);

  const ok = firstChoice({ choices: [{ message: { content: '{"a":1}' }, finish_reason: 'stop' }] }, 'm');
  assert.equal(ok.text, '{"a":1}');
  assert.equal(ok.finishReason, 'stop');
});

test('normalizeFinish: le due famiglie dicono il troncamento con parole diverse', () => {
  assert.equal(normalizeFinish('length'), 'length'); // OpenAI
  assert.equal(normalizeFinish('max_tokens'), 'length'); // Anthropic
  assert.equal(normalizeFinish('end_turn'), 'stop');
  assert.equal(normalizeFinish(null), 'unknown');
});

test('classifyFailure: 5xx e rete NON penalizzano il modello', () => {
  assert.equal(classifyFailure(new TruncatedCompletionError('m')), 'length');
  assert.equal(classifyFailure(new EmptyCompletionError('m')), 'malformed');
  assert.equal(classifyFailure({ status: 429 }), '429');
  assert.equal(classifyFailure({ status: 403 }), '403');
  assert.equal(classifyFailure({ status: 401 }), null); // è la key, non il modello
  assert.equal(classifyFailure({ status: 500 }), null);
  assert.equal(classifyFailure(new Error('socket hang up')), null);
  assert.equal(classifyFailure(new Error('request timed out')), 'timeout');
});

/** Sostituisce `fetch` per il test e restituisce il body inviato. */
function stubFetch(response: unknown, status = 200) {
  const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init.body ?? '{}')),
      headers: init.headers as Record<string, string>,
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => response,
      text: async () => JSON.stringify(response),
    } as Response;
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const anthropic = () =>
  createAnthropicProvider({
    baseURL: 'https://api.anthropic.com/v1',
    apiKey: 'sk-ant-test',
    caps: { json: 'prefill', vision: true, health: 'none', timeoutMs: 5000 },
  });

test('anthropic: system estratto dai messaggi, prefill per il JSON', async () => {
  const stub = stubFetch({ content: [{ type: 'text', text: '"a":1}' }], stop_reason: 'end_turn' });
  try {
    const reply = await anthropic().chat({
      model: 'claude-3-5-haiku-latest',
      json: true,
      messages: [
        { role: 'system', content: 'sei un assistente' },
        { role: 'user', content: 'ciao' },
      ],
    });

    const sent = stub.calls[0].body;
    assert.equal(sent.system, 'sei un assistente', 'il system è un campo, non un messaggio');
    const messages = sent.messages as { role: string; content: { type: string; text?: string }[] }[];
    assert.equal(messages.length, 2, 'user + prefill assistant');
    assert.equal(messages[0].role, 'user');
    assert.equal(messages[1].role, 'assistant');
    assert.equal(messages[1].content[0].text, '{', 'il prefill forza il JSON');
    assert.equal(stub.calls[0].headers['x-api-key'], 'sk-ant-test');
    assert.equal(stub.calls[0].headers['anthropic-version'], '2023-06-01');

    // La graffa del prefill viene ri-anteposta: il chiamante riceve JSON completo.
    assert.equal(reply.text, '{"a":1}');
  } finally {
    stub.restore();
  }
});

test('anthropic: le immagini usano source, non image_url', async () => {
  const stub = stubFetch({ content: [{ type: 'text', text: 'una stanza' }], stop_reason: 'end_turn' });
  try {
    await anthropic().chat({
      model: 'claude-3-5-haiku-latest',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'descrivi' }, { type: 'image', url: 'https://x/y.jpg' }] }],
    });
    const messages = stub.calls[0].body.messages as { content: Record<string, unknown>[] }[];
    const img = messages[0].content[1] as { type: string; source: { type: string; url: string } };
    assert.equal(img.type, 'image');
    assert.deepEqual(img.source, { type: 'url', url: 'https://x/y.jpg' });
  } finally {
    stub.restore();
  }
});

test('anthropic: un data URI diventa source base64 (le foto arrivano dalla cache locale)', async () => {
  const stub = stubFetch({ content: [{ type: 'text', text: 'una stanza' }], stop_reason: 'end_turn' });
  try {
    await anthropic().chat({
      model: 'claude-3-5-haiku-latest',
      messages: [{ role: 'user', content: [{ type: 'image', url: 'data:image/avif;base64,AAECAw==' }] }],
    });
    const messages = stub.calls[0].body.messages as { content: Record<string, unknown>[] }[];
    const img = messages[0].content[0] as { source: Record<string, string> };
    // Anthropic non accetta il data URI dentro `source.url`: va spacchettato.
    assert.deepEqual(img.source, { type: 'base64', media_type: 'image/avif', data: 'AAECAw==' });
  } finally {
    stub.restore();
  }
});

test('anthropic: max_tokens → troncamento, 401 → key invalida', async () => {
  const t = stubFetch({ content: [{ type: 'text', text: 'tagli' }], stop_reason: 'max_tokens' });
  try {
    await assert.rejects(
      anthropic().chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] }),
      TruncatedCompletionError,
    );
  } finally {
    t.restore();
  }

  const k = stubFetch({ error: 'unauthorized' }, 401);
  try {
    await assert.rejects(
      anthropic().chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] }),
      InvalidKeyError,
    );
  } finally {
    k.restore();
  }
});
