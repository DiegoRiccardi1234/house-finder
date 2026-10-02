import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ListingStore } from '../src/core/store.js';
import { ingest, runEmail, runPipeline } from '../src/core/pipeline.js';
import type { Listing } from '../src/core/types.js';
import { Mailbox, type EmailMessage } from '../src/sources/email/imap.js';
import { invalidateMail } from '../src/config/mail.js';
import { invalidateCreds } from '../src/ai/credentials.js';
import { getProvider, invalidateRegistry } from '../src/ai/providers/registry.js';
import { beginScoringTask, endScoringTask } from '../src/ai/endpoint-health.js';
import { CATALOG } from '../src/ai/providers/catalog.js';

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

async function isolatedMailbox(t: TestContext, messages: EmailMessage[]) {
  const fixture = await freshStore();
  const vars = [...new Set(['DATA_DIR', 'IMAP_USER', 'IMAP_PASS', 'CUSTOM_BASE_URL', 'AI_PROVIDER', 'AI_MODEL', ...CATALOG.map((p) => p.envVar)])];
  const previous = Object.fromEntries(vars.map((key) => [key, process.env[key]]));
  for (const key of vars) delete process.env[key];
  process.env.DATA_DIR = fixture.dir;
  process.env.IMAP_USER = 'test@example.invalid';
  process.env.IMAP_PASS = 'test-only';
  await mkdir(join(fixture.dir, 'local'));
  await writeFile(join(fixture.dir, 'searches.json'), JSON.stringify([{ id: 'test', city: 'torino', label: 'Test', maxPrice: 750 }]));
  invalidateMail();
  invalidateCreds();
  invalidateRegistry();
  const seen: number[][] = [];
  let closed = 0;
  t.mock.method(Mailbox.prototype, 'open', async () => {});
  t.mock.method(Mailbox.prototype, 'fetchUnread', async () => messages);
  t.mock.method(Mailbox.prototype, 'markSeen', async (uids: number[]) => { seen.push(uids); });
  t.mock.method(Mailbox.prototype, 'close', async () => { closed++; });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Rete vietata nel test'); });
  t.after(async () => {
    for (const key of vars) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    invalidateMail();
    invalidateCreds();
    invalidateRegistry();
    await rm(fixture.dir, { recursive: true, force: true });
  });
  return { ...fixture, seen, closed: () => closed };
}

const mail = (uid: number, html: string, from = 'alerts@idealista.it'): EmailMessage => ({ uid, html, from, text: '', subject: 'Test' });

test('email: formato sospetto e posta personale restano non letti; solo estrazione valida viene finalizzata', async (t) => {
  const fixture = await isolatedMailbox(t, [
    mail(1, '<p>Formato modificato</p>'),
    mail(2, '<a href="https://www.idealista.it/immobili/22/">Casa</a>'),
    mail(3, '<p>Personale</p>', 'amico@example.invalid'),
  ]);
  const { result, finalize } = await runEmail({ store: fixture.store, score: false, log: () => {} });
  assert.equal(result.fresh, 1);
  assert.equal(result.outcome, 'partial');
  assert.match(result.errors[0], /UID 1.*lasciata non letta/);
  assert.deepEqual(fixture.seen, []);
  await fixture.store.save();
  await finalize(true);
  assert.deepEqual(fixture.seen, [[2]]);
  assert.equal(fixture.closed(), 1);
});

test('pipeline: save fallito non notifica, non marca mail e segnala run fallita', async (t) => {
  const fixture = await isolatedMailbox(t, [mail(1, '<a href="https://www.idealista.it/immobili/22/">Casa</a>')]);
  fixture.store.upsert(L('old'), '2020-01-01T00:00:00.000Z');
  fixture.store.setStatus('immobiliare:old', 'favorite');
  await fixture.store.save();
  const before = fixture.store.checkpoint();
  t.mock.method(fixture.store, 'save', async () => { throw new Error('disco pieno'); });
  const logs: string[] = [];
  const summary = await runPipeline(['email'], { store: fixture.store, score: false, log: (line) => logs.push(line) });
  assert.equal(summary.outcome, 'failed');
  assert.equal(summary.results.length, 1);
  assert.equal(summary.results[0].persisted, false);
  assert.equal(summary.results[0].fresh, 0);
  assert.deepEqual(summary.results[0].newRecords, []);
  assert.match(summary.results[0].errors[0], /salvataggio fallito: disco pieno/);
  assert.deepEqual(fixture.seen, []);
  assert.equal(fixture.closed(), 1);
  assert.match(logs.at(-1)!, /fallita/);
  assert.equal(fixture.store.size, 1);
  assert.deepEqual(fixture.store.checkpoint(), before);
  assert.deepEqual((await ListingStore.load(fixture.path)).checkpoint(), before);
  const retry = await runEmail({ store: fixture.store, score: false, log: () => {} });
  assert.equal(retry.result.fresh, 1, 'dopo rollback gli annunci non salvati sono ancora nuovi');
  await retry.finalize(false);
  assert.deepEqual(fixture.seen, []);
  assert.equal(fixture.store.get('immobiliare:old')?.status, 'favorite');
});

test('email: wrapper recuperato si marca letto soltanto dopo salvataggio', async (t) => {
  const html = `<div><a href="https://l.settimanale.idealista.it/rts/invented-pipeline-ok">Bilocale in via Esempio</a><span>€ 650 · 50 m² · 2 locali</span></div>`;
  const fixture = await isolatedMailbox(t, [mail(41, html)]);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: 'https://www.idealista.it/immobile/41414/' } });
  });
  const { result, finalize } = await runEmail({ store: fixture.store, score: false, log: () => {} });
  assert.equal(result.fresh, 1);
  assert.equal(calls, 1);
  assert.deepEqual(fixture.seen, []);
  await fixture.store.save();
  await finalize(true);
  assert.deepEqual(fixture.seen, [[41]]);
});

test('email: risultati parziali salvati ma mail con wrapper irrisolto resta non letta', async (t) => {
  const html = `<a href="https://www.idealista.it/immobile/51515/">Casa</a><div><a href="https://l.settimanale.idealista.it/rts/invented-pipeline-partial">Bilocale in via Esempio</a><span>€ 650 · 50 m² · 2 locali</span></div>`;
  const fixture = await isolatedMailbox(t, [mail(51, html)]);
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 200 }));
  const { result, finalize } = await runEmail({ store: fixture.store, score: false, log: () => {} });
  assert.equal(result.fresh, 1);
  assert.equal(result.outcome, 'partial');
  assert.match(result.errors[0], /estrazione parziale.*lasciata non letta/);
  await fixture.store.save();
  await finalize(true);
  assert.deepEqual(fixture.seen, []);
  assert.ok((await ListingStore.load(fixture.path)).get('idealista:51515'));
});

test('pipeline: ricerca vuota blocca la scansione prima di aprire IMAP', async (t) => {
  const fixture = await isolatedMailbox(t, []);
  await writeFile(join(fixture.dir, 'searches.json'), '[]');
  await assert.rejects(runPipeline(['email'], { store: fixture.store, score: false }), { code: 'PROFILE_NOT_CONFIGURED' });
  assert.equal(fixture.closed(), 0);
});

test('ingest: rivaluta ai:null preservando stato utente, canale e firstSeen', async (t) => {
  const fixture = await isolatedMailbox(t, []);
  process.env.CUSTOM_BASE_URL = 'http://test.invalid';
  process.env.AI_PROVIDER = 'custom';
  process.env.AI_MODEL = 'test-26b-instruct';
  invalidateRegistry();
  t.mock.method(getProvider('custom'), 'chat', async () => ({ text: '{"scores":[{"id":"immobiliare:1","score":82}]}', finishReason: 'stop' }));
  const firstSeen = '2020-01-01T00:00:00.000Z';
  fixture.store.upsert(L('1'), firstSeen, { channel: 'email', notified: true });
  fixture.store.setStatus('immobiliare:1', 'favorite');
  const result = await ingest([L('1', { title: 'Aggiornato' })], 'immobiliare', { store: fixture.store, score: true, vision: false, log: () => {} });
  assert.equal(result.fresh, 0);
  assert.deepEqual(result.newRecords, []);
  const record = fixture.store.get('immobiliare:1')!;
  assert.equal(record.ai?.score, 82);
  assert.equal(record.status, 'favorite');
  assert.equal(record.firstSeen, firstSeen);
  assert.equal(record.channel, 'email');
  assert.equal(record.notified, true);
  assert.equal(record.listing.title, 'Aggiornato');
});

test('ingest: AI parziale resta visibile; scansione successiva recupera solo il voto mancante', async (t) => {
  const fixture = await isolatedMailbox(t, []);
  process.env.CUSTOM_BASE_URL = 'http://test.invalid';
  process.env.AI_PROVIDER = 'custom';
  process.env.AI_MODEL = 'test-26b-instruct';
  invalidateRegistry();
  let calls = 0;
  t.mock.method(getProvider('custom'), 'chat', async () => {
    calls++;
    return { text: JSON.stringify({ scores: [{ id: calls === 1 ? 'immobiliare:1' : 'immobiliare:2', score: 80 }] }), finishReason: 'stop' };
  });
  const options = { store: fixture.store, score: true, vision: false, log: () => {} };
  beginScoringTask();
  try {
    const first = await ingest([L('1'), L('2')], 'immobiliare', options);
    assert.equal(first.outcome, 'partial');
    assert.match(first.errors[0], /Valutazione AI assente per 1\/2/);
    assert.equal(fixture.store.get('immobiliare:1')?.ai?.score, 80);
    assert.equal(fixture.store.get('immobiliare:2')?.ai, null);
  } finally { endScoringTask(); }
  fixture.store.setStatus('immobiliare:2', 'contacted');
  beginScoringTask();
  try {
    const second = await ingest([L('1'), L('2')], 'immobiliare', options);
    assert.equal(second.outcome, 'succeeded');
    assert.equal(second.fresh, 0);
    assert.equal(fixture.store.get('immobiliare:2')?.ai?.score, 80);
    assert.equal(fixture.store.get('immobiliare:2')?.status, 'contacted');
    assert.equal(calls, 2);
  } finally { endScoringTask(); }
});
