import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseScoreResponse, scoreBatch } from '../src/ai/score.js';
import { invalidateCreds, saveKey, setPrimary } from '../src/ai/credentials.js';
import { CATALOG } from '../src/ai/providers/catalog.js';
import { getProvider, invalidateRegistry } from '../src/ai/providers/registry.js';
import { beginScoringTask, endScoringTask, penaltyScore, clearPenalties } from '../src/ai/endpoint-health.js';
import type { Listing } from '../src/core/types.js';

test('parseScoreResponse: JSON pulito → mappa id→risultato', () => {
  const m = parseScoreResponse('{"scores":[{"id":"a","score":80,"verdict":"ok","worthVisit":true}]}');
  assert.equal(m.size, 1);
  assert.equal(m.get('a')?.ai.score, 80);
  assert.equal(m.get('a')?.ai.worthVisit, true);
});

test('parseScoreResponse: JSON dentro fence + prosa → estratto lo stesso', () => {
  const raw = 'Ecco la valutazione:\n```json\n{"scores":[{"id":"b","score":50}]}\n```\nSpero sia utile.';
  const m = parseScoreResponse(raw);
  assert.equal(m.get('b')?.ai.score, 50);
});

test('parseScoreResponse: item malformati scartati uno a uno, i buoni restano', () => {
  const m = parseScoreResponse('{"scores":[{"id":"c","score":70}, 42, "spazzatura", {"score":10}]}');
  assert.equal(m.size, 1); // 42/"spazzatura" scartati; l'oggetto senza id scartato
  assert.ok(m.get('c'));
});

test('parseScoreResponse: campi mancanti → default tolleranti (score 0)', () => {
  const m = parseScoreResponse('{"scores":[{"id":"d"}]}');
  assert.equal(m.get('d')?.ai.score, 0);
  assert.equal(m.get('d')?.ai.worthVisit, false);
});

test('parseScoreResponse: scores assente → mappa vuota, niente crash', () => {
  assert.equal(parseScoreResponse('{"altro":1}').size, 0);
});

test('parseScoreResponse: ID estranei e duplicati esclusi, validi conservati', () => {
  const m = parseScoreResponse(JSON.stringify({ scores: [
    { id: 'a', score: 80 }, { id: 'b', score: 40 }, { id: 'b', score: 90 },
    { id: 'b', score: 70 }, { id: 'foreign', score: 100 },
  ] }), new Set(['a', 'b']));
  assert.deepEqual([...m.keys()], ['a']);
});

/** Credenziali e provider isolati: la chat viene sempre mockata, niente rete. */
async function withProvider(fn: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'hf-score-'));
  await mkdir(join(dir, 'local'), { recursive: true });
  const envNames = ['DATA_DIR', 'AI_MODEL', 'AI_PROVIDER', ...CATALOG.map((s) => s.envVar)];
  const previous = new Map(envNames.map((name) => [name, process.env[name]]));
  for (const name of envNames) delete process.env[name];
  process.env.DATA_DIR = dir;
  invalidateCreds();
  invalidateRegistry();
  clearPenalties();
  try {
    await saveKey('groq', 'fake-offline-key');
    await setPrimary('groq');
    await fn();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    invalidateCreds();
    invalidateRegistry();
    clearPenalties();
    await rm(dir, { recursive: true, force: true });
  }
}

const listing = (id: string): Listing => ({ source: 'subito', id, title: 'Casa', url: `https://example.invalid/${id}`, price: 500 });

test('scoreBatch: partial e duplicati → solo mancanti ai modelli successivi, senza perdere validi', async (t) => {
  await withProvider(async () => {
    const requests: string[][] = [];
    const models: string[] = [];
    t.mock.method(getProvider('groq'), 'chat', async (req: { model: string; messages: Array<{ content: string }> }) => {
      models.push(req.model);
      const prompt = req.messages[1]!.content;
      const ids = (JSON.parse(prompt.split('ANNUNCI (JSON):\n')[1]!.split('\n\nRispondi con:')[0]!) as Array<{ id: string }>).map((x) => x.id);
      requests.push(ids);
      const scores = requests.length === 1
        ? [{ id: 'subito:a', score: 80 }, { id: 'subito:b', score: 20 }, { id: 'subito:b', score: 90 }, { id: 'foreign', score: 100 }]
        : requests.length === 2 ? [{ id: 'subito:b', score: 70 }] : [{ id: 'subito:c', score: 60 }];
      return { text: JSON.stringify({ scores }), finishReason: 'stop' };
    });
    const result = await scoreBatch(['a', 'b', 'c'].map(listing));
    assert.deepEqual(requests, [['subito:a', 'subito:b', 'subito:c'], ['subito:b', 'subito:c'], ['subito:c']]);
    assert.equal(new Set(models).size, 3, 'una risposta parziale deve cambiare modello');
    assert.equal(result.get('subito:a')?.ai.score, 80);
    assert.equal(result.get('subito:b')?.ai.score, 70);
    assert.equal(result.get('subito:c')?.ai.score, 60);
    assert.equal(penaltyScore(`groq::${models[0]}`), 3);
  });
});

test('scoreBatch: canali condividono penalità; il task standalone successivo le resetta', async (t) => {
  await withProvider(async () => {
    const models: string[] = [];
    let calls = 0;
    t.mock.method(getProvider('groq'), 'chat', async (req: { model: string }) => {
      models.push(req.model);
      calls++;
      return { text: JSON.stringify({ scores: calls === 1 ? [] : [{ id: 'subito:a', score: 80 }] }), finishReason: 'stop' };
    });
    beginScoringTask();
    try {
      await scoreBatch([listing('a')], undefined, { resetPenalties: false });
      const first = models[0]!;
      assert.equal(penaltyScore(`groq::${first}`), 3);
      await scoreBatch([listing('a')], undefined, { resetPenalties: false });
      assert.notEqual(models[2], first, 'il secondo canale non deve ripartire dal modello fallito');
    } finally {
      endScoringTask();
    }
    await scoreBatch([listing('a')]);
    assert.equal(models.at(-1), models[0], 'nuovo task: preferenza iniziale ripristinata');
  });
});

test('scoreBatch: tutti i fallback vuoti conservano i risultati parziali', async (t) => {
  await withProvider(async () => {
    let calls = 0;
    t.mock.method(getProvider('groq'), 'chat', async () => ({
      text: JSON.stringify({ scores: ++calls === 1 ? [{ id: 'subito:a', score: 80 }] : [] }),
      finishReason: 'stop',
    }));
    const result = await scoreBatch(['a', 'b'].map(listing));
    assert.equal(result.size, 1);
    assert.equal(result.get('subito:a')?.ai.score, 80);
    assert.equal(result.has('subito:b'), false);
  });
});
