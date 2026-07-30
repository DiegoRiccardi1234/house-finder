import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ListingStore } from '../src/core/store.js';
import { ingest } from '../src/core/pipeline.js';
import type { Listing } from '../src/core/types.js';

// Collector "finto": creiamo direttamente gli annunci e li diamo in pasto a `ingest`.
// Niente IMAP / browser / rete: `score:false` bypassa l'AI.
function L(id: string, over: Partial<Listing> = {}): Listing {
  return { source: 'immobiliare', id, url: `https://x/${id}`, title: `t${id}`, price: 500, thumb: null, ...over };
}

async function freshStore() {
  const dir = await mkdtemp(join(tmpdir(), 'tc-pipe-'));
  const path = join(dir, 'listings.json');
  const store = await ListingStore.load(path);
  return { dir, path, store };
}

test('ingest: dedup nel run + conteggio nuovi', async () => {
  const { dir, store } = await freshStore();
  const r = await ingest([L('1'), L('1'), L('2')], 'immobiliare', { store, score: false });
  assert.equal(r.collected, 3);
  assert.equal(r.unique, 2);
  assert.equal(r.fresh, 2);
  assert.equal(r.newRecords.length, 2);
  await rm(dir, { recursive: true, force: true });
});

test('ingest: registra channel e photos sui nuovi', async () => {
  const { dir, store } = await freshStore();
  await ingest([L('9', { source: 'subito', thumb: 'https://img/9.jpg' })], 'subito', { store, score: false });
  const rec = store.get('subito:9');
  assert.ok(rec);
  assert.equal(rec.channel, 'subito');
  assert.deepEqual(rec.photos, ['https://img/9.jpg']);
  assert.equal(rec.ai, null);
  assert.equal(rec.notified, false);
  await rm(dir, { recursive: true, force: true });
});

test('re-run: non-nuovo, status utente preservato, lastSeen aggiornato', async () => {
  const { dir, path, store } = await freshStore();
  await ingest([L('1', { thumb: 'p.jpg' })], 'immobiliare', { store, score: false });
  await store.save();
  const firstSeen = store.get('immobiliare:1')!.firstSeen;
  store.setStatus('immobiliare:1', 'favorite');
  await store.save();

  const store2 = await ListingStore.load(path); // ricarica da disco
  const r = await ingest([L('1', { title: 'nuovo-titolo' })], 'immobiliare', { store: store2, score: false });
  assert.equal(r.fresh, 0);
  assert.equal(r.newRecords.length, 0);

  const rec = store2.get('immobiliare:1')!;
  assert.equal(rec.status, 'favorite'); // preservato
  assert.deepEqual(rec.photos, ['p.jpg']); // preservato (nessuna patch sui non-nuovi)
  assert.equal(rec.firstSeen, firstSeen); // preservato
  assert.equal(rec.listing.title, 'nuovo-titolo'); // contenuto rinfrescato
  await rm(dir, { recursive: true, force: true });
});
