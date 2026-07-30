import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ListingStore } from '../src/core/store.js';
import { createApp } from '../src/server/app.js';
import { invalidateCreds, saveKey } from '../src/ai/credentials.js';
import { CATALOG } from '../src/ai/providers/catalog.js';

/**
 * I test non toccano la rete. Dove serve una key salvata si scrive direttamente col modulo
 * credenziali; la PUT HTTP — che per contratto prova la key chiamando `listModels()` — si
 * esercita su `custom` puntato a una porta chiusa, così l'errore è immediato e locale.
 */
const DEAD_ENDPOINT = 'http://127.0.0.1:1/v1';

const SECRET = 'sk-super-segreta-1234567890';

async function withApp(fn: (ctx: { app: ReturnType<typeof createApp>; dir: string }) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'hf-aiapi-'));
  await mkdir(join(dir, 'local'), { recursive: true });
  const storeDir = await mkdtemp(join(tmpdir(), 'hf-aistore-'));
  const prevDir = process.env.DATA_DIR;
  const savedEnv: Record<string, string | undefined> = {};
  for (const s of CATALOG) {
    savedEnv[s.envVar] = process.env[s.envVar];
    delete process.env[s.envVar];
  }
  process.env.DATA_DIR = dir;
  invalidateCreds();
  try {
    const store = await ListingStore.load(join(storeDir, 'listings.json'));
    await fn({ app: createApp({ store }), dir });
  } finally {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (prevDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prevDir;
    invalidateCreds();
    await rm(dir, { recursive: true, force: true });
    await rm(storeDir, { recursive: true, force: true });
  }
}

test('GET /api/ai/providers: elenca il catalogo senza mai esporre una key', async () => {
  await withApp(async ({ app }) => {
    await saveKey('groq', SECRET);

    const res = await request(app).get('/api/ai/providers');
    assert.equal(res.status, 200);
    assert.equal(res.body.providers.length, 11);

    const groq = res.body.providers.find((p: { id: string }) => p.id === 'groq');
    assert.equal(groq.configured, true);
    assert.equal(groq.keyState, 'ok');
    assert.equal(groq.key, undefined, 'la key non deve nemmeno esistere come campo');

    // La verifica che conta: la stringa segreta non compare da nessuna parte nella risposta.
    assert.ok(!JSON.stringify(res.body).includes(SECRET), 'la key è trapelata nel body');
  });
});

test('PUT key: salva in data/local, la key non torna nella risposta', async () => {
  await withApp(async ({ app, dir }) => {
    const res = await request(app)
      .put('/api/ai/providers/custom/key')
      .set('Content-Type', 'application/json')
      .send({ key: SECRET, baseUrl: DEAD_ENDPOINT });

    assert.equal(res.status, 200);
    assert.equal(res.body.configured, true);
    assert.ok(!JSON.stringify(res.body).includes(SECRET), 'la key è trapelata nella risposta');

    const onDisk = JSON.parse(await readFile(join(dir, 'local', 'providers.json'), 'utf8'));
    assert.equal(onDisk.keys.custom, SECRET, 'la key deve essere persistita in locale');
    assert.equal(onDisk.endpoints.custom, DEAD_ENDPOINT);
  });
});

test('PUT key vuota: cancella e il provider torna non configurato', async () => {
  await withApp(async ({ app }) => {
    await saveKey('groq', SECRET);
    const cleared = await request(app)
      .put('/api/ai/providers/groq/key')
      .set('Content-Type', 'application/json')
      .send({ key: '' });

    assert.equal(cleared.body.configured, false);
    assert.equal(cleared.body.keyState, 'missing');
  });
});

test('provider sconosciuto e Content-Type mancante vengono rifiutati', async () => {
  await withApp(async ({ app }) => {
    const bad = await request(app)
      .put('/api/ai/providers/inesistente/key')
      .set('Content-Type', 'application/json')
      .send({ key: 'x' });
    assert.equal(bad.status, 400);

    const noJson = await request(app).put('/api/ai/providers/groq/key').send('key=x');
    assert.equal(noJson.status, 415);
  });
});

test('GET /api/ai/health senza provider: dichiara il motivo invece di fallire', async () => {
  await withApp(async ({ app }) => {
    const res = await request(app).get('/api/ai/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.configured, false);
    assert.deepEqual(res.body.chain, []);
    assert.ok(typeof res.body.reason === 'string' && res.body.reason.length > 0);
  });
});

test('GET /api/ai/providers/:id/models distingue key mancante da key rifiutata', async () => {
  await withApp(async ({ app }) => {
    const missing = await request(app).get('/api/ai/providers/groq/models');
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error, 'key_missing');
  });
});

test('PUT /api/ai/primary rifiuta un provider non configurato', async () => {
  await withApp(async ({ app }) => {
    const res = await request(app)
      .put('/api/ai/primary')
      .set('Content-Type', 'application/json')
      .send({ provider: 'mistral' });
    assert.equal(res.status, 400);
  });
});

test('GET /api/stats risponde con gli aggregati', async () => {
  await withApp(async ({ app }) => {
    const res = await request(app).get('/api/stats');
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 0);
    assert.deepEqual(res.body.byStatus, { new: 0, favorite: 0, contacted: 0, dismissed: 0 });
  });
});
