import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import request from 'supertest';
import {
  acquireLock,
  readLock,
  releaseLock,
  touchLock,
  UPDATE_LOCK_TTL_MS,
  createLockOwner,
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

async function expireLock(dir: string): Promise<void> {
  const owner = readLock(dir)?.owner;
  const file = owner ? join(dir, 'update.lock', `owner-${owner}.json`) : join(dir, 'update.lock');
  const past = new Date(Date.now() - UPDATE_LOCK_TTL_MS - 5_000);
  await utimes(file, past, past);
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
    acquireLock(dir, 'v99.0.0', 111);
    await expireLock(dir);

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

test('aggiornamento durante scansione rifiutato prima del download e del lock', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hf-running-update-'));
  try {
    let checked = false;
    const app = await server(dir, async () => { checked = true; return info(); });
    app.locals.isRunRunning = () => true;
    const response = await request(app).post('/api/update/install').send({});
    assert.equal(response.status, 409);
    assert.equal(response.body.error, 'run_in_progress');
    assert.equal(checked, false);
    assert.equal(readLock(dir), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('scansione iniziata durante check update impedisce lock e download', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hf-update-check-race-'));
  try {
    let running = false;
    const app = await server(dir, async () => { running = true; return info(); });
    app.locals.isRunRunning = () => running;
    const response = await request(app).post('/api/update/install').send({});
    assert.equal(response.status, 409);
    assert.equal(response.body.error, 'run_in_progress');
    assert.equal(readLock(dir), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('scansione durante aggiornamento rifiutata prima della pipeline', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hf-run-update-lock-'));
  try {
    const app = await server(dir, async () => info());
    acquireLock(dir, 'v99.0.0');
    const response = await request(app).post('/api/runs').send({ channels: ['subito'] });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'UPDATE_IN_PROGRESS');
    assert.equal(app.locals.isRunRunning(), false);
  } finally { releaseLock(dir); await rm(dir, { recursive: true, force: true }); }
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

test('DELETE /api/update/lock non sblocca un aggiornamento ancora vivo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hf-lock-'));
  try {
    const app = await server(dir, async () => info());
    acquireLock(dir, 'v99.0.0', 4242);
    assert.ok(readLock(dir));
    const res = await request(app).delete('/api/update/lock');
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'update_in_progress');
    assert.ok(readLock(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('DELETE /api/update/lock sblocca solo un lock scaduto ed è idempotente se assente', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hf-stale-unlock-'));
  try {
    const app = await server(dir, async () => info());
    acquireLock(dir, 'v99.0.0', 4242);
    await expireLock(dir);
    const progress = await request(app).get('/api/update/progress');
    assert.equal(progress.body.lockStale, true);
    assert.equal((await request(app).delete('/api/update/lock')).status, 200);
    assert.equal(readLock(dir), null);
    assert.equal((await request(app).delete('/api/update/lock')).status, 200);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('late heartbeat and release cannot alter the next owner generation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hf-owner-'));
  try {
    const oldOwner = createLockOwner(); const newOwner = createLockOwner();
    assert.equal(acquireLock(dir, '1', 111, oldOwner), true);
    await expireLock(dir);
    assert.equal(acquireLock(dir, '2', 222, newOwner), true);
    assert.equal(touchLock(dir, '1', 111, oldOwner), false);
    assert.equal(releaseLock(dir, oldOwner), false);
    assert.equal(readLock(dir)?.owner, newOwner);
    assert.equal(releaseLock(dir, newOwner), true);
    assert.equal(readLock(dir), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('legacy JSON locks remain busy until expired and can then be replaced', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hf-legacy-lock-'));
  try {
    await writeFile(join(dir, 'update.lock'), JSON.stringify({ pid: 111, version: '1.7.0' }));
    assert.equal(readLock(dir)?.owner, null);
    assert.equal(acquireLock(dir, '1.8.0'), false);
    await expireLock(dir);
    assert.equal(acquireLock(dir, '1.8.0'), true);
    assert.ok(readLock(dir)?.owner);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

for (const mode of ['fresh', 'expired owner', 'legacy JSON'] as const) test(`simultaneous updater processes acquire exactly one owner: ${mode}`, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hf-lock-processes-'));
  try {
    if (mode === 'expired owner') { acquireLock(dir, 'old'); await expireLock(dir); }
    if (mode === 'legacy JSON') {
      await writeFile(join(dir, 'update.lock'), JSON.stringify({ pid: 111, version: '1.7.0' }));
      await expireLock(dir);
    }
    const source = new URL('../src/update/lock.ts', import.meta.url).href;
    const worker = `import {acquireLock} from ${JSON.stringify(source)};
      import {existsSync} from 'node:fs';
      console.log('ready');
      const timer=setInterval(()=>{if(existsSync(process.argv[2])){clearInterval(timer);
        console.log(acquireLock(process.argv[1],'fixture')?'winner':'busy');}},10);`;
    const gate = join(dir, 'start');
    const children = Array.from({ length: 6 }, () => {
      const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', worker, dir, gate],
        { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let output = ''; let errors = '';
      let markReady: () => void;
      const ready = new Promise<void>((resolve) => { markReady = resolve; });
      child.stdout.on('data', (data: Buffer) => { output += data.toString(); if (output.includes('ready')) markReady(); });
      child.stderr.on('data', (data: Buffer) => { errors += data.toString(); });
      const done = new Promise<string>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code) => code === 0 ? resolve(output) : reject(new Error(errors || `exit ${code}`)));
      });
      // A startup failure must reject the readiness wait too.
      void done.catch(() => markReady());
      return { ready, done, child };
    });
    try {
      await Promise.all(children.map((c) => c.ready));
      await writeFile(gate, 'start');
      const outputs = await Promise.all(children.map((c) => c.done));
      assert.equal(outputs.filter((out) => out.includes('winner')).length, 1);
      assert.equal(outputs.filter((out) => out.includes('busy')).length, 5);
    } finally { for (const item of children) item.child.kill(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
