import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ListingStore } from '../src/core/store.js';
import { createApp } from '../src/server/app.js';
import { configReadPath, localConfigPath, sharedConfigPath } from '../src/config/paths.js';

/**
 * Override locale della config: `data/local/<file>` vince in lettura, e TUTTE le scritture
 * finiscono lì. È ciò che impedisce alla config personale di sovrascrivere — e quindi di
 * finire in un commit — i file di esempio versionati in `data/`.
 */
async function withDataDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'hf-cfg-'));
  const prev = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  try {
    await fn(dir);
  } finally {
    if (prev === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prev;
    await rm(dir, { recursive: true, force: true });
  }
}

test('configReadPath: senza override legge il file condiviso', async () => {
  await withDataDir(async (dir) => {
    await writeFile(join(dir, 'criteria.md'), 'shared', 'utf8');
    assert.equal(configReadPath('criteria.md'), sharedConfigPath('criteria.md'));
    assert.equal(await readFile(configReadPath('criteria.md'), 'utf8'), 'shared');
  });
});

test('configReadPath: con override locale vince data/local/', async () => {
  await withDataDir(async (dir) => {
    await writeFile(join(dir, 'criteria.md'), 'shared', 'utf8');
    await mkdir(join(dir, 'local'), { recursive: true });
    await writeFile(join(dir, 'local', 'criteria.md'), 'personale', 'utf8');
    assert.equal(configReadPath('criteria.md'), localConfigPath('criteria.md'));
    assert.equal(await readFile(configReadPath('criteria.md'), 'utf8'), 'personale');
  });
});

test('configReadPath: risolve a ogni chiamata, non al primo import', async () => {
  await withDataDir(async (dir) => {
    await writeFile(join(dir, 'searches.json'), '[]', 'utf8');
    assert.equal(configReadPath('searches.json'), sharedConfigPath('searches.json'));
    // Override creato DOPO la prima risoluzione: deve valere subito, senza riavvio.
    await mkdir(join(dir, 'local'), { recursive: true });
    await writeFile(join(dir, 'local', 'searches.json'), '[]', 'utf8');
    assert.equal(configReadPath('searches.json'), localConfigPath('searches.json'));
  });
});

test('localConfigPath: sempre sotto data/local/', async () => {
  await withDataDir(() => {
    assert.match(localConfigPath('facebook.json').replace(/\\/g, '/'), /\/local\/facebook\.json$/);
    return Promise.resolve();
  });
});

test('PUT /api/config/criteria scrive nel locale e NON tocca il file versionato', async () => {
  await withDataDir(async (dir) => {
    const shared = join(dir, 'criteria.md');
    await writeFile(shared, 'ESEMPIO versionato', 'utf8');

    const storeDir = await mkdtemp(join(tmpdir(), 'hf-store-'));
    const store = await ListingStore.load(join(storeDir, 'listings.json'));
    // Nessun configPaths iniettato: si usa la risoluzione reale (shared/local).
    const app = createApp({ store });

    const put = await request(app).put('/api/config/criteria').send({ content: 'criteri personali' });
    assert.equal(put.status, 200);

    assert.equal(await readFile(shared, 'utf8'), 'ESEMPIO versionato');
    assert.equal(await readFile(join(dir, 'local', 'criteria.md'), 'utf8'), 'criteri personali');

    const get = await request(app).get('/api/config/criteria');
    assert.equal(get.body.content, 'criteri personali');

    await rm(storeDir, { recursive: true, force: true });
  });
});
