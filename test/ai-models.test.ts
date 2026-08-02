import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ListingStore } from '../src/core/store.js';
import { createApp } from '../src/server/app.js';
import { invalidateCreds, saveKey, setPrimary } from '../src/ai/credentials.js';
import { CATALOG, specOf } from '../src/ai/providers/catalog.js';
import { buildChainForTask, modelsForTask } from '../src/ai/failover.js';
import { clearHealthCache } from '../src/ai/endpoint-health.js';

/**
 * La scelta del modello dalla UI.
 *
 * Il punto delicato non è mostrare la lista: è che il motore **rispetti** la scelta. `rankModels`
 * non riordina soltanto — scarta chi ha la salute sotto soglia o la taglia sotto il quality-floor.
 * Prima di questo vincolo un modello fissato a mano poteva sparire dalla catena senza che
 * nessuno lo dicesse, e la UI avrebbe mostrato una scelta che il codice ignorava.
 *
 * I test non toccano la rete: `groq` non pubblica la salute, quindi la sonda è un no-op.
 */
async function withCreds(fn: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'hf-models-'));
  await mkdir(join(dir, 'local'), { recursive: true });
  const prevDir = process.env.DATA_DIR;
  const saved: Record<string, string | undefined> = {};
  for (const s of CATALOG) {
    saved[s.envVar] = process.env[s.envVar];
    delete process.env[s.envVar];
  }
  const prevModel = process.env.AI_MODEL;
  delete process.env.AI_MODEL;
  process.env.DATA_DIR = dir;
  invalidateCreds();
  clearHealthCache();
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (prevModel === undefined) delete process.env.AI_MODEL;
    else process.env.AI_MODEL = prevModel;
    if (prevDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prevDir;
    invalidateCreds();
    clearHealthCache();
    await rm(dir, { recursive: true, force: true });
  }
}

test('GET /api/ai/models: senza provider configurato non inventa niente', async () => {
  await withCreds(async () => {
    const storeDir = await mkdtemp(join(tmpdir(), 'hf-ms-'));
    const store = await ListingStore.load(join(storeDir, 'listings.json'));
    const res = await request(createApp({ store })).get('/api/ai/models');
    assert.equal(res.status, 200);
    assert.equal(res.body.configured, false);
    await rm(storeDir, { recursive: true, force: true });
  });
});

test('GET /api/ai/models: dice il consigliato e su cosa ripiega in automatico', async () => {
  await withCreds(async () => {
    await saveKey('groq', 'sk-finta');
    await setPrimary('groq');
    invalidateCreds();

    const storeDir = await mkdtemp(join(tmpdir(), 'hf-ms-'));
    const store = await ListingStore.load(join(storeDir, 'listings.json'));
    const res = await request(createApp({ store })).get('/api/ai/models');
    assert.equal(res.status, 200);
    assert.equal(res.body.configured, true);
    assert.equal(res.body.provider, 'groq');

    const r = res.body.tasks.reasoning;
    assert.ok(r.candidates.length > 0, 'il pool del provider deve arrivare alla UI');
    assert.equal(r.pinned, null, 'senza scelta esplicita si va in automatico');
    assert.equal(typeof r.auto, 'string', 'la UI deve poter scrivere "Automatico — adesso X"');
    // Il campo che il server calcolava già e il client buttava via.
    assert.ok(r.candidates.some((c: { recommended: boolean }) => c.recommended));
    await rm(storeDir, { recursive: true, force: true });
  });
});

test('il modello fissato a mano resta il primo della catena', async () => {
  await withCreds(async () => {
    await saveKey('groq', 'sk-finta');
    // Un modello che esiste nel pool ma non è il preferito naturale: se il pin non fosse
    // rispettato, il ranking lo rimetterebbe dietro al primo del catalogo.
    const pool = specOf('groq').reasoning;
    const scelto = pool[pool.length - 1] as string;
    await setPrimary('groq', scelto);
    invalidateCreds();
    clearHealthCache();

    const chain = await buildChainForTask('reasoning');
    assert.equal(chain[0]?.provider, 'groq');
    assert.equal(chain[0]?.model, scelto);

    const models = await modelsForTask('reasoning');
    assert.equal(models.pinned, scelto);
    // `auto` NON deve essere il pin: è il modello su cui si ripiega, e va detto sempre.
    assert.notEqual(models.auto, scelto);
  });
});

test('stringa vuota = si torna in automatico', async () => {
  await withCreds(async () => {
    await saveKey('groq', 'sk-finta');
    await setPrimary('groq', specOf('groq').reasoning[1] as string);
    invalidateCreds();
    assert.notEqual((await modelsForTask('reasoning')).pinned, null);

    await setPrimary('groq', '');
    invalidateCreds();
    clearHealthCache();
    assert.equal((await modelsForTask('reasoning')).pinned, null);
  });
});

test('il pin del primario non contamina gli altri provider della catena', async () => {
  await withCreds(async () => {
    await saveKey('groq', 'sk-finta');
    await saveKey('cerebras', 'sk-finta');
    await setPrimary('groq', specOf('groq').reasoning[1] as string);
    invalidateCreds();
    clearHealthCache();

    const scelto = specOf('groq').reasoning[1] as string;
    const chain = await buildChainForTask('reasoning');
    const cerebras = chain.filter((r) => r.provider === 'cerebras');
    // Un modello di Groq offerto a Cerebras sarebbe un 404 garantito al primo failover.
    assert.ok(
      cerebras.every((r) => r.model !== scelto || specOf('cerebras').reasoning.includes(scelto)),
      'il modello fissato su un provider è finito nella lista di un altro',
    );
  });
});
