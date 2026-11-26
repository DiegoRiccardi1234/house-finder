import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import request from 'supertest';

/**
 * Prendere la sessione di Facebook dai browser installati, per chiunque e non solo per chi usa Brave.
 *
 * Nessun browser vero e nessun profilo vero: i percorsi puntano a cartelle temporanee e l'apertura
 * del browser è sostituita. Il file di sessione e il profilo dell'app vanno in una cartella di
 * prova PRIMA di caricare i moduli, perché il percorso si legge all'import.
 */
const root = mkdtempSync(join(tmpdir(), 'hf-fbimport-'));
process.env.FB_STATE_PATH = join(root, 'state', 'fb-state.json');
delete process.env.FB_PROFILE_DIR;

const { listFbBrowsers, importFacebookFrom, firefoxDefaultProfile, firefoxExpiry, firefoxSameSite, operaExe } =
  await import('../src/sources/fb-import.js');
const { fbProfileDir } = await import('../src/sources/fb-session.js');

test.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5 }));

/** Un "computer" finto: cartelle di sistema tutte dentro una temp, nessun browser installato. */
function fakeEnv(name: string): { env: NodeJS.ProcessEnv; base: string } {
  const base = join(root, name);
  const env: NodeJS.ProcessEnv = {
    LOCALAPPDATA: join(base, 'Local'),
    APPDATA: join(base, 'Roaming'),
    ProgramFiles: join(base, 'PF'),
    'ProgramFiles(x86)': join(base, 'PF86'),
  };
  mkdirSync(base, { recursive: true });
  return { env, base };
}

function touch(path: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, '');
}

test('browser: niente installato → tutti presenti in elenco ma non disponibili; Chrome mai importabile', () => {
  const { env } = fakeEnv('vuoto');
  const list = listFbBrowsers(env);
  assert.deepEqual(list.map((b) => b.id), ['brave', 'edge', 'vivaldi', 'opera', 'firefox', 'chrome']);
  assert.ok(list.every((b) => b.available === false));
  const chrome = list.find((b) => b.id === 'chrome')!;
  assert.equal(chrome.importable, false);
  assert.match(chrome.note ?? '', /Accedi da qui/);
  for (const b of list) assert.deepEqual(Object.keys(b).filter((k) => k !== 'note').sort(), ['available', 'id', 'importable', 'label']);
});

test('browser: disponibile solo con programma E profilo; Chrome trovato resta non importabile', () => {
  const { env, base } = fakeEnv('installati');
  // Brave: programma e profilo Default.
  touch(join(base, 'PF', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'));
  mkdirSync(join(base, 'Local', 'BraveSoftware', 'Brave-Browser', 'User Data', 'Default'), { recursive: true });
  // Edge: programma senza profilo → non disponibile.
  touch(join(base, 'PF86', 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  // Vivaldi: installazione per utente.
  touch(join(base, 'Local', 'Vivaldi', 'Application', 'vivaldi.exe'));
  mkdirSync(join(base, 'Local', 'Vivaldi', 'User Data', 'Default'), { recursive: true });
  // Chrome.
  touch(join(base, 'PF', 'Google', 'Chrome', 'Application', 'chrome.exe'));
  mkdirSync(join(base, 'Local', 'Google', 'Chrome', 'User Data', 'Default'), { recursive: true });

  const byId = Object.fromEntries(listFbBrowsers(env).map((b) => [b.id, b]));
  assert.equal(byId.brave!.available, true);
  assert.equal(byId.edge!.available, false);
  assert.equal(byId.vivaldi!.available, true);
  assert.equal(byId.chrome!.available, true);
  assert.equal(byId.chrome!.importable, false);
});

test('Opera: la versione vera nella sottocartella, non il lanciatore; dati = profilo (niente --profile-directory)', async () => {
  const { env, base } = fakeEnv('opera');
  const install = join(base, 'Local', 'Programs', 'Opera');
  touch(join(install, 'opera.exe'));
  touch(join(install, '99.0.4788.9', 'opera.exe'));
  touch(join(install, '120.0.5543.61', 'opera.exe'));
  mkdirSync(join(install, 'autoupdate'), { recursive: true });
  assert.equal(operaExe(install), join(install, '120.0.5543.61', 'opera.exe'));
  assert.equal(operaExe(join(base, 'manca')), join(base, 'manca', 'opera.exe'));

  const userData = join(base, 'Roaming', 'Opera Software', 'Opera Stable');
  mkdirSync(userData, { recursive: true });
  assert.equal(listFbBrowsers(env).find((b) => b.id === 'opera')!.available, true);

  const calls: Array<{ dir: string; opts: Record<string, unknown> }> = [];
  const statePath = join(base, 'out', 'fb.json');
  const id = await importFacebookFrom('opera', () => {}, {
    env,
    statePath,
    launch: async (dir, opts) => {
      calls.push({ dir, opts: opts as Record<string, unknown> });
      return fakeContext([
        { name: 'c_user', value: '1001', domain: '.facebook.com' },
        { name: 'xs', value: 'segreto', domain: '.facebook.com' },
        { name: 'SID', value: 'altro-sito', domain: '.google.com' },
      ]);
    },
  });
  assert.equal(id, '1001');
  assert.equal(calls[0]!.dir, userData);
  assert.equal(calls[0]!.opts.executablePath, join(install, '120.0.5543.61', 'opera.exe'));
  assert.deepEqual(calls[0]!.opts.args, []);
  const saved = JSON.parse(readFileSync(statePath, 'utf8')) as { cookies: Array<{ name: string }> };
  // Solo Facebook nel file, mai i cookie degli altri siti.
  assert.deepEqual(saved.cookies.map((c) => c.name).sort(), ['c_user', 'xs']);
  assert.equal(existsSync(`${statePath}.tmp`), false); // scrittura atomica: niente avanzi
});

test('Brave: profilo passato con --profile-directory; browser aperto → "chiudi Brave"; senza c_user → errore chiaro', async () => {
  const { env, base } = fakeEnv('brave');
  touch(join(base, 'PF', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'));
  mkdirSync(join(base, 'Local', 'BraveSoftware', 'Brave-Browser', 'User Data', 'Profile 2'), { recursive: true });
  env.BRAVE_PROFILE = 'Profile 2';
  const statePath = join(base, 'fb.json');

  let args: unknown;
  await importFacebookFrom('brave', () => {}, {
    env, statePath,
    launch: async (_dir, opts) => { args = opts?.args; return fakeContext([{ name: 'c_user', value: '7', domain: '.facebook.com' }]); },
  });
  assert.deepEqual(args, ['--profile-directory=Profile 2']);

  await assert.rejects(
    importFacebookFrom('brave', () => {}, { env, statePath, launch: async () => { throw new Error('ProcessSingleton'); } }),
    /chiudi Brave del tutto \(anche dall'area di notifica\) e riprova/,
  );
  await assert.rejects(
    importFacebookFrom('brave', () => {}, { env, statePath, launch: async () => fakeContext([{ name: 'datr', value: 'x', domain: '.facebook.com' }]) }),
    /In Brave non risulti dentro Facebook/,
  );
});

test('Chrome e browser mancanti: rifiuto con il perché', async () => {
  const { env } = fakeEnv('rifiuti');
  await assert.rejects(importFacebookFrom('chrome', () => {}, { env }), /Accedi da qui/);
  await assert.rejects(importFacebookFrom('edge', () => {}, { env }), /Microsoft Edge non trovato/);
});

test('Firefox: scadenza in ms → s, sameSite 0/1/2, None senza Secure diventa Lax', () => {
  assert.equal(firefoxExpiry(1_900_000_000), 1_900_000_000);
  assert.equal(firefoxExpiry(1_900_000_000_000), 1_900_000_000);
  assert.equal(firefoxExpiry(0), -1);
  assert.equal(firefoxSameSite(0, true), 'None');
  assert.equal(firefoxSameSite(0, false), 'Lax');
  assert.equal(firefoxSameSite(1, true), 'Lax');
  assert.equal(firefoxSameSite(2, true), 'Strict');
  assert.equal(firefoxSameSite(256, true), 'Lax');
});

test('Firefox: profilo predefinito da profiles.ini ([Install] prima, poi Default=1, poi percorsi assoluti)', () => {
  const dir = join(root, 'ffini');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'profiles.ini'),
    '[Profile1]\nName=vecchio\nIsRelative=1\nPath=Profiles/old.default\nDefault=1\n\n' +
    '[Install308046B0AF4A39CB]\nDefault=Profiles/abc.default-release\nLocked=1\n');
  assert.equal(firefoxDefaultProfile(dir), join(dir, 'Profiles/abc.default-release'));
  writeFileSync(join(dir, 'profiles.ini'), '[Profile0]\nName=a\nIsRelative=0\nPath=D:\\FF\\p\n\n[Profile1]\nIsRelative=1\nPath=Profiles/b\nDefault=1\n');
  assert.equal(firefoxDefaultProfile(dir), join(dir, 'Profiles/b'));
  // Percorso assoluto per la piattaforma che esegue il test: la CI gira anche su Linux.
  const abs = join(root, 'altrove', 'p');
  writeFileSync(join(dir, 'profiles.ini'), `[Profile0]\nName=a\nIsRelative=0\nPath=${abs}\n`);
  assert.equal(firefoxDefaultProfile(dir), abs);
  assert.equal(firefoxDefaultProfile(join(root, 'nessuno')), null);
});

function firefoxProfile(name: string, rows: Array<[string, string, string, number, number, number, string?]>) {
  const { env, base } = fakeEnv(name);
  const ffDir = join(base, 'Roaming', 'Mozilla', 'Firefox');
  const prof = join(ffDir, 'Profiles', 'abc.default-release');
  mkdirSync(prof, { recursive: true });
  writeFileSync(join(ffDir, 'profiles.ini'), '[Install1]\nDefault=Profiles/abc.default-release\n');
  touch(join(base, 'PF', 'Mozilla Firefox', 'firefox.exe'));
  const db = new DatabaseSync(join(prof, 'cookies.sqlite'));
  db.exec(`CREATE TABLE moz_cookies (id INTEGER PRIMARY KEY, originAttributes TEXT NOT NULL DEFAULT '',
    name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER, lastAccessed INTEGER, creationTime INTEGER,
    isSecure INTEGER, isHttpOnly INTEGER, inBrowserElement INTEGER DEFAULT 0, sameSite INTEGER DEFAULT 0)`);
  const ins = db.prepare('INSERT INTO moz_cookies (name, value, host, path, expiry, isSecure, isHttpOnly, sameSite, originAttributes) VALUES (?,?,?,?,?,?,?,?,?)');
  for (const [n, v, host, expiry, secure, sameSite, oa] of rows) ins.run(n, v, host, '/', expiry, secure, 1, sameSite, oa ?? '');
  db.close();
  return { env, base };
}

test('Firefox: legge una copia del database, solo Facebook e solo fuori dai contenitori', async () => {
  const { env, base } = firefoxProfile('firefox', [
    ['c_user', '4242', '.facebook.com', 1_900_000_000_000, 1, 0],
    ['xs', 'segreto', '.facebook.com', 1_900_000_000, 1, 2],
    ['datr', 'dispositivo', '.facebook.com', 1_900_000_000, 0, 0],
    ['c_user', '9999', '.facebook.com', 1_900_000_000, 1, 0, '^userContextId=1'],
    ['x', 'y', '.notfacebook.com', 1_900_000_000, 1, 0],
    ['SID', 'z', '.google.com', 1_900_000_000, 1, 0],
  ]);
  assert.equal(listFbBrowsers(env).find((b) => b.id === 'firefox')!.available, true);
  const statePath = join(base, 'fb.json');
  const lines: string[] = [];
  const id = await importFacebookFrom('firefox', (l) => lines.push(l), { env, statePath });
  assert.equal(id, '4242');
  const saved = JSON.parse(readFileSync(statePath, 'utf8')) as {
    cookies: Array<{ name: string; value: string; domain: string; expires: number; sameSite: string; secure: boolean; httpOnly: boolean }>;
  };
  const byName = Object.fromEntries(saved.cookies.map((c) => [c.name, c]));
  assert.deepEqual(Object.keys(byName).sort(), ['c_user', 'datr', 'xs']);
  assert.equal(byName.c_user!.expires, 1_900_000_000);
  assert.equal(byName.c_user!.sameSite, 'None');
  assert.equal(byName.xs!.sameSite, 'Strict');
  assert.equal(byName.datr!.sameSite, 'Lax');
  assert.equal(byName.c_user!.domain, '.facebook.com');
  assert.equal(byName.c_user!.httpOnly, true);
  // I valori non finiscono mai nel log.
  assert.equal(lines.join('\n').includes('segreto'), false);
});

test('Firefox: senza c_user → "In Firefox non risulti dentro Facebook"', async () => {
  const { env, base } = firefoxProfile('firefox-fuori', [['datr', 'd', '.facebook.com', 1_900_000_000, 1, 0]]);
  await assert.rejects(
    importFacebookFrom('firefox', () => {}, { env, statePath: join(base, 'fb.json') }),
    /In Firefox non risulti dentro Facebook/,
  );
  assert.equal(existsSync(join(base, 'fb.json')), false);
});

test('API: GET /facebook/session elenca i browser; POST /facebook/import valida; DELETE tiene il profilo salvo all:true', async () => {
  const { env } = fakeEnv('api');
  const saved: Record<string, string | undefined> = {};
  const keys = ['LOCALAPPDATA', 'APPDATA', 'ProgramFiles', 'ProgramFiles(x86)',
    ...['BRAVE', 'EDGE', 'VIVALDI', 'OPERA', 'CHROME'].flatMap((p) => [`${p}_EXE`, `${p}_USER_DATA`, `${p}_PROFILE`]),
    'FIREFOX_DIR', 'FIREFOX_EXE', 'FIREFOX_PROFILE_DIR'];
  for (const k of keys) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, env);
  const storeDir = mkdtempSync(join(root, 'store-'));
  try {
    const { ListingStore } = await import('../src/core/store.js');
    const { createApp } = await import('../src/server/app.js');
    const store = await ListingStore.load(join(storeDir, 'listings.json'));
    const app = createApp({ store, stateDir: storeDir });

    const get = await request(app).get('/api/facebook/session');
    assert.equal(get.status, 200);
    assert.equal(get.body.exists, false);
    assert.equal(get.body.profileReady, false);
    assert.equal(get.body.braveAvailable, false);
    assert.equal(get.body.browsers.length, 6);
    assert.deepEqual(Object.keys(get.body.browsers[0]).sort(), ['available', 'id', 'importable', 'label']);

    const noJson = await request(app).post('/api/facebook/import').set('Content-Type', 'text/plain').send('brave');
    assert.equal(noJson.status, 415);
    const unknown = await request(app).post('/api/facebook/import').send({ browser: 'netscape' });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.error, 'unknown_browser');
    const chrome = await request(app).post('/api/facebook/import').send({ browser: 'chrome' });
    assert.equal(chrome.status, 400);
    assert.match(chrome.body.detail, /Accedi da qui/);

    // "Dimentica": il profilo dell'app resta (niente nuova verifica), con all:true se ne va.
    const profile = fbProfileDir();
    mkdirSync(profile, { recursive: true });
    writeFileSync(process.env.FB_STATE_PATH!, JSON.stringify({ cookies: [{ name: 'c_user', value: '1', domain: '.facebook.com', expires: -1 }] }));
    assert.equal((await request(app).get('/api/facebook/session')).body.profileReady, true);
    assert.equal((await request(app).delete('/api/facebook/session')).status, 200);
    assert.equal(existsSync(process.env.FB_STATE_PATH!), false);
    assert.equal(existsSync(profile), true);
    const all = await request(app).delete('/api/facebook/session').send({ all: true });
    assert.equal(all.status, 200);
    assert.equal(existsSync(profile), false);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

/** Un context finto con i metodi che l'import usa davvero. */
function fakeContext(cookies: Array<{ name: string; value: string; domain: string }>) {
  const page = { goto: async () => null, waitForTimeout: async () => {} };
  return {
    pages: () => [page],
    newPage: async () => page,
    storageState: async () => ({
      cookies: cookies.map((c) => ({ ...c, path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'None' as const })),
      origins: [{ origin: 'https://www.facebook.com', localStorage: [] }, { origin: 'https://www.google.com', localStorage: [] }],
    }),
    close: async () => {},
  } as unknown as import('playwright').BrowserContext;
}
