import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ListingStore } from '../src/core/store.js';
import { createApp } from '../src/server/app.js';
import { APP_VERSION } from '../src/version.js';

/**
 * La versione sta in tre posti che nessuno tiene allineati da solo. Questo test è ciò che
 * trasforma la dimenticanza in un test rosso invece che in una release che si annuncia col
 * numero sbagliato — è già successo tre volte in Job Finder prima che ci mettessero un vincolo.
 */

const root = new URL('../', import.meta.url);

async function versionOf(rel: string): Promise<string> {
  const raw = await readFile(fileURLToPath(new URL(rel, root)), 'utf8');
  return (JSON.parse(raw) as { version: string }).version;
}

test('la versione è la stessa in src/version.ts, package.json e ui/package.json', async () => {
  assert.equal(await versionOf('package.json'), APP_VERSION);
  assert.equal(await versionOf('ui/package.json'), APP_VERSION);
});

test('/api/meta espone la versione: senza, la pagina non sa di parlare col server nuovo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hf-ver-'));
  try {
    const store = await ListingStore.load(join(dir, 'listings.json'));
    const app = createApp({ store, stateDir: dir });
    const res = await request(app).get('/api/meta');
    assert.equal(res.status, 200);
    assert.equal(res.body.version, APP_VERSION);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
