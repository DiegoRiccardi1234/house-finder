import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import express from 'express';
import request from 'supertest';
import { connectionConfig, saveConnectionConfig, publicConnections, hasExplicitRoute, routeConfigured } from '../src/ai/connections.js';
import { taskChat, TaskRoutingError } from '../src/ai/task-routing.js';
import { createConnectionRouter } from '../src/server/connectionRoutes.js';
import { invalidateCreds } from '../src/ai/credentials.js';
import { scoreBatch } from '../src/ai/score.js';
import type { Listing } from '../src/core/types.js';

async function isolated(run: (path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'hf-connections-test-'));
  const oldDir = process.env.DATA_DIR, oldFetch = globalThis.fetch;
  process.env.DATA_DIR = dir; invalidateCreds();
  try { await run(dir); } finally {
    globalThis.fetch = oldFetch;
    if (oldDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = oldDir;
    invalidateCreds(); await rm(dir, { recursive: true, force: true });
  }
}
const apiConnection = (id: string) => ({ id, label: id, kind: 'api' as const, baseUrl: `http://127.0.0.1:1/${id}/v1`,
  model: `${id}-model`, vision: true, enabled: true });
function completion(text: string, finish = 'stop') {
  return Response.json({ choices: [{ message: { content: text }, finish_reason: finish }] });
}
test('connessioni: routing riferimenti/capacità validati e segreti separati senza perdere provider esistenti', () => isolated(async (dir) => {
  await mkdir(join(dir, 'local'));
  await writeFile(join(dir, 'local/providers.json'), '{"keys":{"openrouter":"legacy-secret"}}');
  assert.deepEqual(connectionConfig(), { version: 1, connections: [], tasks: {} });
  await saveConnectionConfig({ version: 1, connections: [apiConnection('local')], tasks: { chat: { connectionId: 'local', fallbackIds: [] } } }, { local: 'connection-secret' });
  assert.equal(publicConnections().connections[0].hasKey, true);
  assert.doesNotMatch(JSON.stringify(publicConnections()), /connection-secret|legacy-secret/);
  assert.doesNotMatch(await readFile(join(dir, 'local/ai-connections.json'), 'utf8'), /connection-secret/);
  assert.match(await readFile(join(dir, 'local/providers.json'), 'utf8'), /legacy-secret/);
  await assert.rejects(saveConnectionConfig({ version: 1, connections: [apiConnection('local')], tasks: { scoring: { connectionId: 'missing' } } }));
  await assert.rejects(saveConnectionConfig({ version: 1, connections: [{ id: 'c', label: 'Claude', kind: 'claude', vision: true }], tasks: {} }));
  await assert.rejects(saveConnectionConfig({ version: 1, connections: [{ ...apiConnection('a'), baseUrl: 'http://user:secret@localhost/v1' }], tasks: {} }));
  await assert.rejects(saveConnectionConfig({ version: 1, connections: [{ ...apiConnection('a'), baseUrl: 'http://example.invalid/v1' }], tasks: {} }));
  await assert.rejects(saveConnectionConfig({ version: 1, connections: [{ ...apiConnection('a'), baseUrl: 'https://example.invalid/v1?key=secret' }], tasks: {} }));
}));
test('routing esplicito: pin legacy e altri provider non possono scavalcare task; fallback solo configurati', () => isolated(async (dir) => {
  await mkdir(join(dir, 'local'));
  await writeFile(join(dir, 'local/providers.json'), JSON.stringify({ primary: 'openrouter', models: { reasoning: 'wrong-model' }, keys: { openrouter: 'unused' } }));
  await saveConnectionConfig({ version: 1, connections: [apiConnection('first'), apiConnection('second')], tasks: {
    chat: { connectionId: 'first', fallbackIds: ['second'] }, scoring: { connectionId: 'first', fallbackIds: [] },
  } });
  const hosts: string[] = [], models: string[] = [];
  globalThis.fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    hosts.push(req.url); models.push(JSON.parse(await req.text()).model);
    if (req.url.includes('/first/')) return Response.json({ error: { message: 'not available' } }, { status: 503 });
    return completion('{"value":2}');
  };
  assert.equal(hasExplicitRoute('chat'), true); assert.equal(routeConfigured('chat'), true);
  assert.equal((await taskChat('chat', { messages: [{ role: 'user', content: 'synthetic' }], json: true, schema: z.object({ value: z.number() }) })).text, '{"value":2}');
  assert.deepEqual(models, ['first-model', 'second-model']);
  assert.ok(hosts.every((url) => url.startsWith('http://127.0.0.1:1/')));
  hosts.length = 0;
  await assert.rejects(taskChat('scoring', { messages: [{ role: 'user', content: 'synthetic' }] }), TaskRoutingError);
  assert.equal(hosts.length, 1);
}));
test('routing JSON: troncamento e schema non valido rifiutati senza accettare successo apparente', () => isolated(async () => {
  await saveConnectionConfig({ version: 1, connections: [apiConnection('local')], tasks: { chat: { connectionId: 'local' } } });
  for (const [text, finish] of [['{"ok":true}', 'length'], ['{"ok":false}', 'stop'], ['invalid', 'stop']]) {
    globalThis.fetch = async () => completion(text, finish);
    await assert.rejects(taskChat('chat', { messages: [{ role: 'user', content: 'fixture' }], json: true, schema: z.object({ ok: z.literal(true) }) }));
  }
}));
test('scoring esplicito conserva parsing ID e voto e lascia incompleti rivalutabili senza fallback API', () => isolated(async () => {
  await saveConnectionConfig({ version: 1, connections: [apiConnection('local')], tasks: { scoring: { connectionId: 'local' } } });
  globalThis.fetch = async () => completion('{"scores":[{"id":"subito:one","score":85},{"id":"outside","score":99},{"id":"subito:two","score":101}]}');
  const records: Listing[] = [{ source: 'subito', id: 'one', url: 'https://example.invalid/one', title: 'Fixture1', price: null },
    { source: 'subito', id: 'two', url: 'https://example.invalid/two', title: 'Fixture2', price: null }];
  const result = await scoreBatch(records);
  assert.equal(result.size, 1); assert.equal(result.get('subito:one')?.ai.score, 85);
}));
test('API connessioni: secrets non serializzati e GET diagnostica non esegue completion', () => isolated(async () => {
  const app = express(); app.use(express.json()); app.use('/api', createConnectionRouter());
  const config = { version: 1, connections: [apiConnection('local')], tasks: { chat: { connectionId: 'local' } }, secrets: { local: 'not-in-response' } };
  const saved = await request(app).put('/api/ai/connections').send(config).expect(200);
  assert.doesNotMatch(JSON.stringify(saved.body), /not-in-response/);
  let calls = 0;
  globalThis.fetch = async (input) => { calls++; assert.match(String(input instanceof Request ? input.url : input), /\/models$/); return Response.json({ data: [{ id: 'fixture-model' }] }); };
  await request(app).get('/api/ai/connections/local/diagnostics').expect(200);
  assert.equal(calls, 1);
  await request(app).post('/api/ai/connections/local/test').set('Content-Type', 'text/plain').send('x').expect(415);
  await request(app).get('/api/ai/connections/missing/diagnostics').expect(404);
}));
test('config corrotta: errore esplicito conserva file, nessuna migrazione o ritorno silenzioso ai provider', () => isolated(async (dir) => {
  await mkdir(join(dir, 'local')); await writeFile(join(dir, 'local/ai-connections.json'), '{broken');
  assert.throws(() => connectionConfig(), /originale.*conservato/);
  assert.equal(await readFile(join(dir, 'local/ai-connections.json'), 'utf8'), '{broken');
}));
