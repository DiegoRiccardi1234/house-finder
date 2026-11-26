import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ListingStore } from '../src/core/store.js';
import { createApp } from '../src/server/app.js';
import { invalidateProfile, normalizeProfile, renderCriteria, type Profile } from '../src/config/profile.js';
import { mergeProposal } from '../src/agent/service.js';

/**
 * I campi nuovi del profilo (chi cerca casa, area, riferimento, soglia) si perdevano in tre punti:
 * la lettura da disco, il salvataggio dalla UI e la conferma di una proposta dell'agente.
 */

const AREA: [number, number][] = [[45.02, 7.63], [45.06, 7.63], [45.06, 7.68]];
const REF = { label: 'Lavoro', address: 'Corso Unione Sovietica 216', lat: 45.03822, lng: 7.65225 };

test('normalizeProfile: tiene tenant, soglia, area e riferimento validi; scarta quelli rotti', () => {
  const p = normalizeProfile({
    searches: [],
    tenant: { occupazione: 'lavoratore', genere: 'uomo', animali: false },
    askThreshold: 72,
    zones: [
      { city: 'torino', keep: [], avoid: [], area: { polygon: AREA }, riferimento: REF },
      { city: 'bari', keep: [], avoid: [], area: { polygon: [[1, 2]] }, riferimento: { label: 'x', address: '', lat: 999, lng: 0 } },
    ],
  });
  assert.deepEqual(p.tenant, { occupazione: 'lavoratore', genere: 'uomo', animali: false, fumatore: null });
  assert.equal(p.askThreshold, 72);
  assert.deepEqual(p.zones[0]!.area?.polygon, AREA);
  assert.equal(p.zones[0]!.riferimento?.label, 'Lavoro');
  assert.equal(p.zones[1]!.area, undefined);
  assert.equal(p.zones[1]!.riferimento, undefined);
  assert.equal(normalizeProfile({ searches: [], tenant: { occupazione: 'pirata' as never } }).tenant, undefined);
});

test('criteri per l\'AI: sezione CHI CERCA CASA e riferimento', () => {
  const text = renderCriteria({
    searches: [{ id: 'b', city: 'torino', label: 'Torino · bilocale', maxPrice: 700 }],
    zones: [{ city: 'torino', keep: [], avoid: [], riferimento: REF }],
    musts: [], notes: '',
    tenant: { occupazione: 'lavoratore', genere: null, animali: null, fumatore: false },
  });
  assert.match(text, /CHI CERCA CASA[^\n]*\n- Occupazione: lavoratore \(NON studente\)\n- Fumatore: no/);
  assert.match(text, /RIFERIMENTO[^\n]*\n- Torino: Lavoro — Corso Unione Sovietica 216/);
  assert.doesNotMatch(text, /Genere|Animali/);
});

test('proposta dell\'agente: non cancella chi cerca casa, soglia, area e riferimento', () => {
  const current: Profile = {
    searches: [], musts: [], notes: '',
    zones: [{ city: 'torino', keep: ['Crocetta'], avoid: [], area: { polygon: AREA }, riferimento: REF }],
    tenant: { occupazione: 'lavoratore' }, askThreshold: 65,
  };
  const merged = mergeProposal(current, { searches: [], zones: [{ city: 'torino', keep: ['Santa Rita'], avoid: [] }], musts: [], notes: 'x' });
  assert.deepEqual(merged.zones[0]!.keep, ['Santa Rita']);
  assert.deepEqual(merged.zones[0]!.area?.polygon, AREA);
  assert.equal(merged.zones[0]!.riferimento?.lat, REF.lat);
  assert.equal(merged.tenant?.occupazione, 'lavoratore');
  assert.equal(merged.askThreshold, 65);
  const senzaCitta = mergeProposal(current, { searches: [], zones: [], musts: [], notes: '' });
  assert.deepEqual(senzaCitta.zones[0]!.area?.polygon, AREA);
});

test('PUT /api/config/profile salva i campi nuovi e riapplica le regole', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hf-tenant-'));
  await mkdir(join(dir, 'local'), { recursive: true });
  const prev = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  invalidateProfile();
  try {
    const store = await ListingStore.load(join(dir, 'listings.json'));
    const tri = store.upsert({ source: 'subito', id: '1', url: 'u', title: 'Trilocale', price: 650, rooms: 3 }, '2026-11-26T10:00:00.000Z');
    const app = createApp({ store, stateDir: dir });
    const res = await request(app).put('/api/config/profile').send({
      searches: [{ city: 'torino', label: 'Torino · bilocale', maxPrice: 700, minRooms: 2, maxRooms: 2, tipo: 'bilocale' }],
      zones: [{ city: 'torino', keep: [], avoid: [], area: { polygon: AREA }, riferimento: REF }],
      musts: [], notes: '',
      tenant: { occupazione: 'lavoratore', fumatore: false },
      askThreshold: 75,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.profile.searches[0].tipo, 'bilocale');
    assert.equal(res.body.profile.tenant.occupazione, 'lavoratore');
    assert.equal(res.body.profile.askThreshold, 75);
    assert.deepEqual(res.body.profile.zones[0].area.polygon, AREA);
    const again = await request(app).get('/api/config/profile');
    assert.equal(again.body.profile.zones[0].riferimento.label, 'Lavoro');
    assert.equal(store.get(tri.key)?.status, 'dismissed');
    assert.equal(store.get(tri.key)?.auto?.rule, 'locali');
    const list = await request(app).get('/api/listings?status=active');
    assert.equal(list.body.length, 0);
    assert.equal(list.headers['x-auto-dismissed'], '1');
  } finally {
    if (prev === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = prev;
    invalidateProfile();
    await rm(dir, { recursive: true, force: true });
  }
});
