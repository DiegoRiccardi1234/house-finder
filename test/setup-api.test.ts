import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ListingStore } from '../src/core/store.js';
import { createApp } from '../src/server/app.js';
import { invalidateMail, mailConfigured } from '../src/config/mail.js';
import { readSession } from '../src/sources/fb-login.js';

/**
 * Le cose che prima si facevano solo da terminale.
 *
 * Quello che si difende qui è una regola sola: **dal pacchetto scaricabile deve essere possibile
 * configurare tutto**. E la regola d'oro delle credenziali — la password non torna mai al browser —
 * vale per la posta esattamente come per le key AI.
 */

const SEGRETO = 'password-super-segreta-42';

async function withMail(fn: (app: ReturnType<typeof createApp>) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'hf-mail-'));
  await mkdir(join(dir, 'local'), { recursive: true });
  const storeDir = await mkdtemp(join(tmpdir(), 'hf-mailstore-'));
  const prevDir = process.env.DATA_DIR;
  const salvate: Record<string, string | undefined> = {};
  for (const k of ['IMAP_HOST', 'IMAP_PORT', 'IMAP_USER', 'IMAP_PASS', 'IMAP_FOLDER']) {
    salvate[k] = process.env[k];
    delete process.env[k];
  }
  process.env.DATA_DIR = dir;
  invalidateMail();
  try {
    const store = await ListingStore.load(join(storeDir, 'listings.json'));
    await fn(createApp({ store, stateDir: storeDir }));
  } finally {
    for (const [k, v] of Object.entries(salvate)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (prevDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prevDir;
    invalidateMail();
    await rm(dir, { recursive: true, force: true });
    await rm(storeDir, { recursive: true, force: true });
  }
}

test('la password della posta non torna mai al browser', async () => {
  await withMail(async (app) => {
    const salva = await request(app)
      .put('/api/config/mail')
      .send({ host: 'in.esempio.it', user: 'io@esempio.it', pass: SEGRETO });
    assert.equal(salva.status, 200);
    assert.equal(salva.body.configured, true);
    assert.equal(salva.body.user, 'io@esempio.it');
    // Non mascherata: il campo proprio non esiste, così non può finire in un log o in uno screenshot.
    assert.equal(salva.body.pass, undefined);
    assert.equal(JSON.stringify(salva.body).includes(SEGRETO), false);

    const letto = await request(app).get('/api/config/mail');
    assert.equal(letto.body.pass, undefined);
    assert.equal(JSON.stringify(letto.body).includes(SEGRETO), false);
  });
});

test('campo password vuoto = "non l\'ho toccata", non "cancellala"', async () => {
  await withMail(async (app) => {
    await request(app)
      .put('/api/config/mail')
      .send({ host: 'in.esempio.it', user: 'io@esempio.it', pass: SEGRETO });
    assert.equal(mailConfigured(), true);

    // Cambiare solo la cartella non deve buttare via la password: la UI non la ripropone mai,
    // quindi arriverebbe vuota a ogni modifica successiva.
    const dopo = await request(app)
      .put('/api/config/mail')
      .send({ host: 'in.esempio.it', user: 'io@esempio.it', pass: '', folder: 'Annunci' });
    assert.equal(dopo.status, 200);
    assert.equal(dopo.body.folder, 'Annunci');
    invalidateMail();
    assert.equal(mailConfigured(), true, 'la password è stata cancellata da un campo vuoto');
  });
});

test('le credenziali finiscono in data/local, non nel repo', async () => {
  await withMail(async (app) => {
    await request(app).put('/api/config/mail').send({ user: 'io@esempio.it', pass: SEGRETO });
    const file = join(process.env.DATA_DIR ?? '', 'local', 'mail.json');
    const raw = await readFile(file, 'utf8');
    assert.ok(raw.includes(SEGRETO), 'la password deve essere salvata dove il server la legge');
  });
});

test('il canale email si accende con le credenziali dalla UI, senza toccare il .env', async () => {
  await withMail(async (app) => {
    const prima = await request(app).get('/api/meta');
    assert.equal(prima.body.imapConfigured, false);
    const canale = (prima.body.channels as Array<{ id: string; reason: string }>).find(
      (c) => c.id === 'email',
    );
    // Il messaggio deve indicare un posto nella UI: chi legge non ha un terminale da aprire.
    assert.match(canale?.reason ?? '', /Config/);

    await request(app).put('/api/config/mail').send({ user: 'io@esempio.it', pass: SEGRETO });
    const dopo = await request(app).get('/api/meta');
    assert.equal(dopo.body.imapConfigured, true);
  });
});

test('rimuovere le credenziali spegne il canale', async () => {
  await withMail(async (app) => {
    await request(app).put('/api/config/mail').send({ user: 'io@esempio.it', pass: SEGRETO });
    const via = await request(app).delete('/api/config/mail');
    assert.equal(via.status, 200);
    assert.equal(via.body.configured, false);
  });
});

test('la sessione Facebook si legge senza aprire un browser', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hf-fb-'));
  try {
    const file = join(dir, 'fb-state.json');
    assert.deepEqual(readSession(file), { exists: false, accountId: null, expiresAt: null });

    await writeFile(
      file,
      JSON.stringify({
        cookies: [
          { name: 'datr', value: 'x', expires: 2000000000 },
          { name: 'c_user', value: '100012345', expires: 1800000000 },
        ],
      }),
    );
    const s = readSession(file);
    assert.equal(s.exists, true);
    // Mostrare l'account collegato è ciò che distingue "c'è una sessione" da "c'è la TUA sessione".
    assert.equal(s.accountId, '100012345');
    assert.equal(s.expiresAt, new Date(1800000000 * 1000).toISOString());

    // Un file senza c_user non è una sessione, anche se ci sono altri cookie.
    await writeFile(file, JSON.stringify({ cookies: [{ name: 'datr', value: 'x' }] }));
    assert.equal(readSession(file).exists, false);

    await writeFile(file, 'non è json');
    assert.equal(readSession(file).exists, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('un lavoro sconosciuto non esiste, e quelli noti partono da fermi', async () => {
  await withMail(async (app) => {
    assert.equal((await request(app).get('/api/jobs/inventato')).status, 404);
    const fb = await request(app).get('/api/jobs/fb-login');
    assert.equal(fb.status, 200);
    assert.equal(fb.body.running, false);
    assert.equal(fb.body.outcome, null);
  });
});
