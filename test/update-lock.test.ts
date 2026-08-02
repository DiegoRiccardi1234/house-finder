import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import {
  acquireLock,
  readLock,
  releaseLock,
  touchLock,
  UPDATE_LOCK_TTL_MS,
} from '../src/update/lock.js';
import { lastEvent, writeEvent } from '../src/update/events.js';
import { ListingStore } from '../src/core/store.js';
import { createApp } from '../src/server/app.js';
import type { UpdateInfo } from '../src/update/check.js';

/**
 * Il doppio click sul pulsante ha lanciato due aggiornatori contemporanei su Job Finder — due PID
 * a 35 secondi di distanza, entrambi a copiare gli stessi file. Il lucchetto è la guardia; il
 * battito è ciò che evita di doverne tarare due, uno per parte, con numeri che non concordano.
 */

const info = (over: Partial<UpdateInfo> = {}): UpdateInfo => ({
  current: '1.2.0',
  latest: 'v99.0.0',
  updateAvailable: true,
  releaseUrl: null,
  notes: '',
  asset: { name: 'HouseFinder-windows.zip', size: 10, url: 'https://example/x.zip', digest: null },
  checked: true,
  frozen: true,
  detail: null,
  ...over,
});

async function server(stateDir: string, check: () => Promise<UpdateInfo>) {
  const store = await ListingStore.load(join(stateDir, 'listings.json'));
  return createApp({ store, stateDir, checkUpdate: check });
}

test('un secondo aggiornamento non parte finché il primo è vivo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hf-lock-'));
  try {
    assert.equal(acquireLock(dir, 'v99.0.0', 111), true);
    // Stesso PID: è il proprietario, può ritoccare.
    assert.equal(acquireLock(dir, 'v99.0.0', 111), true);
    // Un altro processo no.
    assert.equal(acquireLock(dir, 'v99.0.0', 222), false);
    releaseLock(dir);
    assert.equal(acquireLock(dir, 'v99.0.0', 222), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('un lucchetto scaduto viene scavalcato: restare bloccati per sempre è peggio', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hf-lock-'));
  try {
    touchLock(dir, 'v99.0.0', 111);
    const { utimesSync } = await import('node:fs');
    const vecchio = new Date(Date.now() - UPDATE_LOCK_TTL_MS - 5_000);
    utimesSync(join(dir, 'update.lock'), vecchio, vecchio);

    const stato = readLock(dir);
    assert.equal(stato?.stale, true);
    assert.equal(acquireLock(dir, 'v99.0.0', 222), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('POST /api/update/install risponde 409 se un aggiornamento è già in corso', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hf-lock-'));
  try {
    const app = await server(dir, async () => info());
    acquireLock(dir, 'v99.0.0', 999);
    const res = await request(app).post('/api/update/install').send({});
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'update_in_progress');
    assert.equal(res.body.lockTtlMs, UPDATE_LOCK_TTL_MS);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('niente da aggiornare e installazione dai sorgenti: due 409 distinti e spiegati', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hf-lock-'));
  try {
    const nulla = await server(dir, async () => info({ updateAvailable: false }));
    const a = await request(nulla).post('/api/update/install').send({});
    assert.equal(a.status, 409);
    assert.equal(a.body.error, 'no_update');

    const sorgenti = await server(dir, async () => info({ frozen: false }));
    const b = await request(sorgenti).post('/api/update/install').send({});
    assert.equal(b.status, 409);
    assert.equal(b.body.error, 'source_install');
    assert.match(b.body.detail, /git pull/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('se manca node.exe si rinuncia e si RESTITUISCE il lucchetto', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hf-lock-'));
  const finta = await mkdtemp(join(tmpdir(), 'hf-noexe-'));
  process.env.INSTALL_ROOT = finta; // niente node.exe dentro
  try {
    const app = await server(dir, async () => info());
    const res = await request(app).post('/api/update/install').send({});
    assert.equal(res.status, 500);
    assert.equal(res.body.error, 'node_exe_missing');
    // Un lucchetto lasciato lì renderebbe il pulsante morto per i prossimi due minuti.
    assert.equal(readLock(dir), null);
  } finally {
    delete process.env.INSTALL_ROOT;
    await rm(dir, { recursive: true, force: true });
    await rm(finta, { recursive: true, force: true });
  }
});

test('/progress smette di dire "riavvio 95%" quando l\'aggiornamento è finito', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hf-prog-'));
  try {
    const app = await server(dir, async () => info());

    // In corso: evento non terminale + lucchetto vivo.
    acquireLock(dir, 'v99.0.0');
    writeEvent(dir, { step: 'restart', pct: 95, detail: 'riavvio' });
    const durante = await request(app).get('/api/update/progress');
    assert.equal(durante.body.step, 'restart');
    assert.equal(durante.body.busy, true);

    // Finito: `done` è terminale. Senza uno stato terminale l'endpoint continuerebbe a dire
    // "riavvio, 95%" per sempre, perché il diario è in append — è il bug latente di Job Finder.
    writeEvent(dir, { step: 'done', pct: 100 });
    releaseLock(dir);
    const dopo = await request(app).get('/api/update/progress');
    assert.equal(dopo.body.step, 'done');
    assert.equal(dopo.body.busy, false);
    assert.equal(lastEvent(dir)?.pct, 100);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('DELETE /api/update/lock sblocca un aggiornamento appeso', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hf-lock-'));
  try {
    const app = await server(dir, async () => info());
    acquireLock(dir, 'v99.0.0', 4242);
    assert.ok(readLock(dir));
    const res = await request(app).delete('/api/update/lock');
    assert.equal(res.status, 200);
    assert.equal(readLock(dir), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
