import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm, writeFile, readFile } from 'node:fs/promises';
import { ListingStore } from '../src/core/store.js';
import { dedupKey } from '../src/core/state.js';
import type { Listing, ListingFields } from '../src/core/types.js';

function listing(over: Partial<Listing> = {}): Listing {
  return {
    source: 'immobiliare',
    id: '123',
    url: 'https://www.immobiliare.it/annunci/123/',
    title: 'Bilocale Crocetta',
    price: 650,
    thumb: 'https://img/1.jpg',
    ...over,
  };
}

const tmpPath = () => join(tmpdir(), `trova-store-${process.pid}-${Math.random().toString(36).slice(2)}.json`);

test('load vuoto: size 0 e isNew true', async () => {
  const s = await ListingStore.load(tmpPath());
  assert.equal(s.size, 0);
  assert.equal(s.isNew(listing()), true);
});

test('upsert crea il record con default corretti', async () => {
  const s = await ListingStore.load(tmpPath());
  const rec = s.upsert(listing(), '2026-07-09T10:00:00.000Z');
  assert.equal(s.size, 1);
  assert.equal(rec.key, 'immobiliare:123');
  assert.equal(rec.firstSeen, '2026-07-09T10:00:00.000Z');
  assert.equal(rec.lastSeen, '2026-07-09T10:00:00.000Z');
  assert.equal(rec.status, 'new');
  assert.equal(rec.notified, false);
  assert.deepEqual(rec.photos, ['https://img/1.jpg']);
  assert.equal(s.isNew(listing()), false);
});

test('upsert successivo preserva firstSeen e status, aggiorna lastSeen e patch', async () => {
  const s = await ListingStore.load(tmpPath());
  s.upsert(listing(), '2026-07-09T10:00:00.000Z');
  s.setStatus('immobiliare:123', 'favorite');
  const rec = s.upsert(listing({ price: 640 }), '2026-07-09T20:00:00.000Z', {
    ai: { score: 82, verdict: 'ok', pros: ['prezzo'], cons: [], worthVisit: true },
    notified: true,
  });
  assert.equal(rec.firstSeen, '2026-07-09T10:00:00.000Z'); // preservato
  assert.equal(rec.lastSeen, '2026-07-09T20:00:00.000Z'); // aggiornato
  assert.equal(rec.status, 'favorite'); // scelta utente preservata
  assert.equal(rec.notified, true);
  assert.equal(rec.ai?.score, 82);
  assert.equal(rec.listing.price, 640); // contenuto aggiornato
});

test('upsert: fields salvato, round-trip e preservato al re-upsert', async () => {
  const path = tmpPath();
  try {
    const fields = { arredato: 'sì', classe_energetica: 'C', vincoli_inquilino: ['no animali'] } as unknown as ListingFields;
    const s = await ListingStore.load(path);
    s.upsert(listing(), '2026-07-09T10:00:00.000Z', { fields });
    await s.save();

    const s2 = await ListingStore.load(path);
    assert.equal(s2.get('immobiliare:123')?.fields?.arredato, 'sì');
    assert.equal(s2.get('immobiliare:123')?.fields?.classe_energetica, 'C');

    s2.upsert(listing({ price: 600 }), '2026-07-09T20:00:00.000Z'); // re-upsert senza fields → preserva
    assert.equal(s2.get('immobiliare:123')?.fields?.arredato, 'sì');
  } finally {
    await rm(path, { force: true });
  }
});

test('setStatus su key inesistente ritorna false', async () => {
  const s = await ListingStore.load(tmpPath());
  assert.equal(s.setStatus('immobiliare:999', 'dismissed'), false);
});

test('prune: rimuove i record che non passano il predicato', async () => {
  const s = await ListingStore.load(tmpPath());
  s.upsert(listing({ id: 'a' }), 'T');
  s.upsert(listing({ id: 'b' }), 'T');
  s.upsert(listing({ id: 'c' }), 'T');
  const removed = s.prune((r) => r.listing.id !== 'b');
  assert.equal(removed, 1);
  assert.equal(s.size, 2);
  assert.equal(s.get('immobiliare:b'), undefined);
  assert.ok(s.get('immobiliare:a'));
});

test('save + reload: round-trip persistente', async () => {
  const path = tmpPath();
  try {
    const s = await ListingStore.load(path);
    s.upsert(listing(), '2026-07-09T10:00:00.000Z', { channel: 'email' });
    s.setStatus('immobiliare:123', 'contacted');
    await s.save();

    const s2 = await ListingStore.load(path);
    assert.equal(s2.size, 1);
    const rec = s2.get('immobiliare:123');
    assert.equal(rec?.status, 'contacted');
    assert.equal(rec?.channel, 'email');
    assert.equal(rec?.listing.title, 'Bilocale Crocetta');
    assert.equal(s2.isNew(listing()), false);
  } finally {
    await rm(path, { force: true });
  }
});

// --- Durabilità (Fase 1) ---

test('dedupKey: id degenere ("null") ripiega sull URL → niente collisione', () => {
  const a = dedupKey(listing({ source: 'idealista', id: null as unknown as string, url: 'https://x/1' }));
  const b = dedupKey(listing({ source: 'idealista', id: 'null', url: 'https://x/2' }));
  assert.notEqual(a, b); // due annunci senza id NON collassano sulla stessa chiave
  assert.equal(a, 'idealista:https://x/1');
  // stesso annuncio (stesso url) → stessa chiave, deterministica
  assert.equal(dedupKey(listing({ source: 'idealista', id: '', url: 'https://x/1' })), a);
});

test('load: file corrotto SENZA backup → rilancia, NON azzera in silenzio', async () => {
  const path = tmpPath();
  try {
    await writeFile(path, '{ questo non è json valido', 'utf8');
    await assert.rejects(() => ListingStore.load(path), /corrotto/i);
  } finally {
    await rm(path, { force: true });
  }
});

test('load: file corrotto CON backup valido → ripristina dal .bak', async () => {
  const path = tmpPath();
  try {
    await writeFile(path, 'JSON ROTTO', 'utf8');
    await writeFile(`${path}.bak`, JSON.stringify({ 'immobiliare:123': makeStored() }), 'utf8');
    const s = await ListingStore.load(path);
    assert.equal(s.size, 1);
    assert.ok(s.get('immobiliare:123'));
  } finally {
    await rm(path, { force: true });
    await rm(`${path}.bak`, { force: true });
  }
});

test('save atomico: mantiene .bak col contenuto del salvataggio precedente', async () => {
  const path = tmpPath();
  try {
    const s = await ListingStore.load(path);
    s.upsert(listing({ id: 'v1' }), 'T');
    await s.save(); // primo save: nessun .bak ancora
    s.upsert(listing({ id: 'v2' }), 'T');
    await s.save(); // secondo save: .bak = stato dopo il primo
    const bak = JSON.parse(await readFile(`${path}.bak`, 'utf8'));
    assert.ok(bak['immobiliare:v1']);
    assert.equal(bak['immobiliare:v2'], undefined); // il .bak è il "buono precedente"
  } finally {
    await rm(path, { force: true });
    await rm(`${path}.bak`, { force: true });
    await rm(`${path}.tmp`, { force: true });
  }
});

// Record minimo valido per i test di ripristino.
function makeStored() {
  return {
    key: 'immobiliare:123',
    listing: listing(),
    ai: null,
    fields: null,
    visionSummary: null,
    photos: [],
    channel: 'immobiliare',
    firstSeen: 'T',
    lastSeen: 'T',
    status: 'new',
    notified: false,
  };
}
