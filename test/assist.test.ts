import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ListingStore } from '../src/core/store.js';
import { createApp } from '../src/server/app.js';
import { invalidateCreds, saveKey, setPrimary } from '../src/ai/credentials.js';
import { CATALOG } from '../src/ai/providers/catalog.js';
import { invalidateProfile } from '../src/config/profile.js';
import { invalidateRegistry } from '../src/ai/providers/registry.js';
import { clearPenalties } from '../src/ai/endpoint-health.js';

/**
 * L'aiuto dell'AI al momento di configurare.
 *
 * Quello che si difende qui non è "il modello risponde bene" — quello non si può garantire. È che
 * **una risposta sbagliata non diventi una configurazione rotta**: una città che i portali non
 * sanno aprire va rifiutata, non salvata, altrimenti la scansione gira e non trova mai niente
 * senza che nessuno dica perché.
 *
 * I test non toccano la rete: si sostituisce `fetch`, che è la via da cui passa il provider.
 */
type Fetch = typeof globalThis.fetch;

/**
 * Un provider OpenAI-compatibile finto che risponde quello che gli si dice.
 *
 * Il registro dei provider **tiene in cache il client**, e il client cattura `fetch` quando viene
 * costruito: senza invalidarlo, il secondo test riceve la risposta del primo e i controlli che
 * dovrebbero fallire passano. È costato tre test rossi che sembravano difetti del codice.
 */
function conRisposta(contenuto: string): () => void {
  invalidateRegistry();
  const originale = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes('/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'finto/modello' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { content: contenuto }, finish_reason: 'stop' }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as unknown as Fetch;
  return () => {
    globalThis.fetch = originale;
    invalidateRegistry();
  };
}

async function conApp(fn: (app: ReturnType<typeof createApp>) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'hf-assist-'));
  await mkdir(join(dir, 'local'), { recursive: true });
  const storeDir = await mkdtemp(join(tmpdir(), 'hf-assist-store-'));
  const prevDir = process.env.DATA_DIR;
  const salvate: Record<string, string | undefined> = {};
  for (const s of CATALOG) {
    salvate[s.envVar] = process.env[s.envVar];
    delete process.env[s.envVar];
  }
  process.env.DATA_DIR = dir;
  invalidateCreds();
  invalidateProfile();
  invalidateRegistry();
  // Le penalità sono per coppia provider+modello e vivono nel processo: un test che simula un
  // fallimento sposterebbe la catena di quello dopo.
  clearPenalties();
  try {
    await saveKey('groq', 'sk-finta');
    await setPrimary('groq');
    invalidateCreds();
    const store = await ListingStore.load(join(storeDir, 'listings.json'));
    await fn(createApp({ store, stateDir: storeDir }));
  } finally {
    for (const [k, v] of Object.entries(salvate)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (prevDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prevDir;
    invalidateCreds();
    invalidateProfile();
    await rm(dir, { recursive: true, force: true });
    await rm(storeDir, { recursive: true, force: true });
  }
}

test('una frase diventa una ricerca compilata', async () => {
  await conApp(async (app) => {
    const restore = conRisposta(
      JSON.stringify({
        city: 'bologna',
        maxPrice: 750,
        minRooms: 2,
        maxRooms: 2,
        kind: 'bilocale',
        musts: ['Arredato'],
        zonesKeep: ['Bolognina'],
        zonesAvoid: [],
        notes: 'vicino alla stazione',
      }),
    );
    try {
      const res = await request(app)
        .post('/api/assist/search')
        .send({ text: 'bilocale arredato a Bologna sotto 750' });
      assert.equal(res.status, 200);
      assert.equal(res.body.city, 'bologna');
      assert.equal(res.body.profile.searches.length, 1);
      assert.equal(res.body.profile.searches[0].maxPrice, 750);
      assert.equal(res.body.profile.musts[0], 'Arredato');
      assert.deepEqual(res.body.profile.zones[0].keep, ['Bolognina']);
      assert.deepEqual(res.body.missing, []);
    } finally {
      restore();
    }
  });
});

test('una città che i portali non sanno aprire viene rifiutata, non salvata', async () => {
  await conApp(async (app) => {
    const restore = conRisposta(JSON.stringify({ city: 'atlantide', maxPrice: 500 }));
    try {
      const res = await request(app).post('/api/assist/search').send({ text: 'casa ad Atlantide' });
      assert.equal(res.status, 422);
      assert.equal(res.body.error, 'unknown_city');
      // Il messaggio dice cosa ha capito e cosa fare: senza, l'utente non saprebbe che correggere.
      assert.match(res.body.detail, /atlantide/i);
      assert.match(res.body.detail, /elenco/i);
    } finally {
      restore();
    }
  });
});

test('quello che manca si chiede, non si inventa', async () => {
  await conApp(async (app) => {
    const restore = conRisposta(JSON.stringify({ city: 'torino', maxPrice: null }));
    try {
      const res = await request(app).post('/api/assist/search').send({ text: 'casa a Torino' });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.missing, ['il budget massimo']);
      // Senza prezzo non si fabbrica una ricerca con un numero a caso.
      assert.equal(res.body.profile.searches.length, 0);
    } finally {
      restore();
    }
  });
});

test('"centro" e "periferia" non sono quartieri, e non passano', async () => {
  await conApp(async (app) => {
    const restore = conRisposta(
      JSON.stringify({
        city: 'bologna',
        maxPrice: 700,
        zonesKeep: ['centro', 'Bolognina', 'zone centrali'],
        zonesAvoid: ['periferia', 'Pilastro'],
      }),
    );
    try {
      const res = await request(app).post('/api/assist/search').send({ text: 'vicino al centro' });
      assert.deepEqual(res.body.profile.zones[0].keep, ['Bolognina']);
      assert.deepEqual(res.body.profile.zones[0].avoid, ['Pilastro']);
    } finally {
      restore();
    }
  });
});

test('i quartieri inclusi nell\'app arrivano senza chiamare l\'AI', async () => {
  await conApp(async (app) => {
    // Nessuno stub: se questa rotta chiamasse la rete, il test la userebbe davvero.
    const res = await request(app).get('/api/assist/zones/torino');
    assert.equal(res.status, 200);
    assert.equal(res.body.source, 'incluso');
    assert.ok(res.body.zones.includes('Crocetta'));
    assert.ok(res.body.zones.length > 10);
  });
});

test('una città sconosciuta non ha quartieri da proporre', async () => {
  await conApp(async (app) => {
    const res = await request(app).get('/api/assist/zones/atlantide');
    assert.equal(res.status, 404);
  });
});

test('senza chiave AI si dice cosa serve, e i campi restano a mano', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hf-noai-'));
  await mkdir(join(dir, 'local'), { recursive: true });
  const storeDir = await mkdtemp(join(tmpdir(), 'hf-noai-store-'));
  const prevDir = process.env.DATA_DIR;
  const salvate: Record<string, string | undefined> = {};
  for (const s of CATALOG) {
    salvate[s.envVar] = process.env[s.envVar];
    delete process.env[s.envVar];
  }
  process.env.DATA_DIR = dir;
  invalidateCreds();
  try {
    const store = await ListingStore.load(join(storeDir, 'listings.json'));
    const app = createApp({ store, stateDir: storeDir });
    const res = await request(app).post('/api/assist/search').send({ text: 'bilocale a Torino' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'ai_missing');
    assert.match(res.body.detail, /a mano/);
  } finally {
    for (const [k, v] of Object.entries(salvate)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (prevDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prevDir;
    invalidateCreds();
    await rm(dir, { recursive: true, force: true });
    await rm(storeDir, { recursive: true, force: true });
  }
});
