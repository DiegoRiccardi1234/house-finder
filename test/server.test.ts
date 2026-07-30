import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ListingStore } from '../src/core/store.js';
import { createApp } from '../src/server/app.js';
import { RunManager, RunBusyError } from '../src/server/runManager.js';
import type { RunSummary } from '../src/core/pipeline.js';
import type { Listing } from '../src/core/types.js';

function L(id: string, over: Partial<Listing> = {}): Listing {
  return { source: 'immobiliare', id, url: `https://immobiliare.it/annunci/${id}`, title: `Casa ${id}`, price: 600, ...over };
}

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'tc-srv-'));
  const store = await ListingStore.load(join(dir, 'listings.json'));
  const now = '2026-07-13T00:00:00.000Z';
  store.upsert(L('1', { zone: 'Crocetta' }), now, { channel: 'email', ai: { score: 90, verdict: 'ottima', pros: [], cons: [], worthVisit: true } });
  store.upsert(L('2', { source: 'subito', url: 'https://subito.it/x-2.htm', price: 400 }), now, { channel: 'subito', ai: { score: 40, verdict: 'meh', pros: [], cons: [], worthVisit: false } });
  await store.save();
  const paths = { criteria: join(dir, 'criteria.md'), searches: join(dir, 'searches.json'), facebook: join(dir, 'facebook.json') };
  const app = createApp({ store, runPipeline: async () => ({ runId: 'r', channels: [], results: [], startedAt: '', finishedAt: '' }), configPaths: paths });
  return { dir, store, app, paths };
}

test('GET /api/listings: tutti + filtri + sort', async () => {
  const { dir, app } = await setup();
  const all = await request(app).get('/api/listings');
  assert.equal(all.status, 200);
  assert.equal(all.body.length, 2);
  assert.equal(all.body[0].key, 'immobiliare:1'); // sort default = score desc

  const onlyEmail = await request(app).get('/api/listings?channel=email');
  assert.equal(onlyEmail.body.length, 1);
  assert.equal(onlyEmail.body[0].channel, 'email');

  const highScore = await request(app).get('/api/listings?minScore=50');
  assert.equal(highScore.body.length, 1);
  assert.equal(highScore.body[0].ai.score, 90);

  const byPrice = await request(app).get('/api/listings?sort=price');
  assert.equal(byPrice.body[0].listing.price, 400);
  await rm(dir, { recursive: true, force: true });
});

test('PATCH status: persiste, 404, 400', async () => {
  const { dir, app } = await setup();
  const ok = await request(app).patch('/api/listings/immobiliare:1/status').send({ status: 'favorite' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, 'favorite');

  const reloaded = await ListingStore.load(join(dir, 'listings.json'));
  assert.equal(reloaded.get('immobiliare:1')?.status, 'favorite');

  const notFound = await request(app).patch('/api/listings/nope:0/status').send({ status: 'favorite' });
  assert.equal(notFound.status, 404);

  const bad = await request(app).patch('/api/listings/immobiliare:1/status').send({ status: 'boh' });
  assert.equal(bad.status, 400);
  await rm(dir, { recursive: true, force: true });
});

test('POST /api/listings/reset: svuota archivio', async () => {
  const { dir, app } = await setup();
  const before = await request(app).get('/api/listings');
  assert.equal(before.body.length, 2);
  const reset = await request(app).post('/api/listings/reset').send({});
  assert.equal(reset.status, 200);
  assert.equal(reset.body.cleared, 2);
  // Senza Content-Type application/json → rifiutato (guard anti-CSRF).
  assert.equal((await request(app).post('/api/listings/reset')).status, 415);
  const after = await request(app).get('/api/listings');
  assert.equal(after.body.length, 0);
  await rm(dir, { recursive: true, force: true });
});

test('config searches: round-trip + validazione', async () => {
  const { dir, app } = await setup();
  const good = [{ id: 'torino-bilocale', city: 'torino', label: 'Torino bilo', maxPrice: 700, minRooms: 2 }];
  const put = await request(app).put('/api/config/searches').send(good);
  assert.equal(put.status, 200);
  const get = await request(app).get('/api/config/searches');
  assert.deepEqual(get.body, good);

  const bad = await request(app).put('/api/config/searches').send([{ id: 'x', city: 'milano', label: 'no', maxPrice: -1 }]);
  assert.equal(bad.status, 400);
  await rm(dir, { recursive: true, force: true });
});

test('config criteria: round-trip', async () => {
  const { dir, app } = await setup();
  await request(app).put('/api/config/criteria').send({ content: 'CITTA: Torino' });
  const get = await request(app).get('/api/config/criteria');
  assert.equal(get.body.content, 'CITTA: Torino');
  await rm(dir, { recursive: true, force: true });
});

test('POST /api/runs: 202 + 409 se occupato', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tc-run-'));
  const store = await ListingStore.load(join(dir, 'listings.json'));
  let release: (s: RunSummary) => void = () => {};
  const pending = new Promise<RunSummary>((r) => (release = r));
  const app = createApp({ store, runPipeline: () => pending });

  const first = await request(app).post('/api/runs').send({ channels: ['email'] });
  assert.equal(first.status, 202);
  assert.ok(first.body.runId);

  const second = await request(app).post('/api/runs').send({ channels: ['email'] });
  assert.equal(second.status, 409);

  const badBody = await request(app).post('/api/runs').send({ channels: [] });
  assert.equal(badBody.status, 400);

  release({ runId: 'x', channels: ['email'], results: [], startedAt: '', finishedAt: '' });
  await pending;
  await rm(dir, { recursive: true, force: true });
});

test('endpoint distruttivi: 409 mentre una run è in corso', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tc-guard-'));
  const store = await ListingStore.load(join(dir, 'listings.json'));
  let release: (s: RunSummary) => void = () => {};
  const pending = new Promise<RunSummary>((r) => (release = r));
  const app = createApp({ store, runPipeline: () => pending });

  const started = await request(app).post('/api/runs').send({ channels: ['email'] });
  assert.equal(started.status, 202);

  assert.equal((await request(app).post('/api/listings/reset').send({})).status, 409);
  assert.equal((await request(app).post('/api/listings/refilter').send({})).status, 409);
  assert.equal((await request(app).put('/api/config/criteria').send({ content: 'X' })).status, 409);

  release({ runId: 'x', channels: ['email'], results: [], startedAt: '', finishedAt: '' });
  await pending;
  // A run finita l'endpoint torna disponibile.
  assert.equal((await request(app).post('/api/listings/reset').send({})).status, 200);
  await rm(dir, { recursive: true, force: true });
});

test('RunManager: guardia busy + replay buffer + done', async () => {
  const rm = new RunManager();
  const events: Array<{ type: string }> = [];
  let release: (s: RunSummary) => void = () => {};
  const pending = new Promise<RunSummary>((r) => (release = r));
  const id = rm.start(['email'], (log) => {
    log('ciao');
    return pending;
  });
  assert.ok(id);
  assert.equal(rm.isRunning, true);
  assert.throws(() => rm.start(['email'], async () => ({ runId: '', channels: [], results: [], startedAt: '', finishedAt: '' })), RunBusyError);

  rm.subscribe((e) => events.push(e)); // replay del buffer
  assert.deepEqual(events[0], { type: 'log', line: 'ciao' });

  release({ runId: 'x', channels: ['email'], results: [], startedAt: '', finishedAt: '' });
  await pending;
  await new Promise((r) => setImmediate(r));
  assert.equal(rm.isRunning, false);
  assert.ok(events.some((e) => e.type === 'done'));
});
