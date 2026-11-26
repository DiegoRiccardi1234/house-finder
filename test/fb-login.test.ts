import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loginComplete, loginToFacebook } from '../src/sources/fb-login.js';
import { INSTALLED_CHANNELS, isMissingChannelError, isProfileInUseError, launchPersistentProfile } from '../src/core/browser.js';
import { braveAvailable, bravePaths, importFacebookFromBrave } from '../src/sources/fb-import.js';
import { claimProfile, fbProfileDir } from '../src/sources/fb-session.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContext } from 'playwright';

test('login Facebook: c_user durante la verifica NON basta, serve uscire dalle pagine di controllo', () => {
  // Facebook imposta c_user già sulla pagina del codice: salvare qui lasciava la sessione a metà.
  assert.equal(loginComplete(true, ['https://www.facebook.com/checkpoint/?next=https%3A%2F%2Fwww.facebook.com%2F']), false);
  assert.equal(loginComplete(true, ['https://www.facebook.com/two_step_verification/two_factor/']), false);
  assert.equal(loginComplete(true, ['https://www.facebook.com/auth_platform/codesubmit/']), false);
  assert.equal(loginComplete(true, ['https://www.facebook.com/login/?next=x']), false);
  // Una scheda ancora in verifica blocca anche se un'altra è già sul feed.
  assert.equal(loginComplete(true, ['https://www.facebook.com/', 'https://www.facebook.com/checkpoint/123']), false);
  assert.equal(loginComplete(false, ['https://www.facebook.com/']), false);
  assert.equal(loginComplete(true, []), false);
  assert.equal(loginComplete(true, ['https://www.facebook.com/']), true);
  assert.equal(loginComplete(true, ['https://www.facebook.com/groups/feed/']), true);
});

test('sessione da Brave: percorsi di default, pulsante solo se installato, errore chiaro se manca', async () => {
  const paths = bravePaths({ LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' });
  assert.equal(paths.profile, 'Default');
  assert.match(paths.userData, /BraveSoftware[\\/]Brave-Browser[\\/]User Data$/);
  const missing = { userData: join(tmpdir(), 'hf-no-brave'), exe: join(tmpdir(), 'hf-no-brave', 'brave.exe'), profile: 'Default' };
  assert.equal(braveAvailable(missing), false);
  await assert.rejects(importFacebookFromBrave(() => {}, { paths: missing, statePath: join(tmpdir(), 'hf-no-brave', 'fb.json') }), /Brave non trovato/);
});

test('browser installato preferito: prima Chrome, poi Edge', () => {
  assert.deepEqual([...INSTALLED_CHANNELS], ['chrome', 'msedge']);
});

test('profilo dell\'app: default accanto al file di sessione, scavalcabile con FB_PROFILE_DIR', () => {
  assert.equal(fbProfileDir({ FB_STATE_PATH: join('x', 'state', 'fb-state.json') }), join('x', 'state', 'fb-browser-profile'));
  assert.equal(fbProfileDir({ FB_PROFILE_DIR: join('y', 'p') }), join('y', 'p'));
});

test('profilo persistente: si passa al canale dopo solo se quello prima manca, mai se il profilo è bloccato', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hf-persist-'));
  const prev = process.env.BROWSER_CHANNEL;
  delete process.env.BROWSER_CHANNEL;
  try {
    const tried: Array<string | undefined> = [];
    const note = (c?: string) => { tried.push(c); };
    const fake = { addInitScript: async () => {} } as unknown as BrowserContext;
    const { channel } = await launchPersistentProfile(dir, {
      launch: (async (_d: string, o?: { channel?: string }) => {
        tried.push(o?.channel);
        if (o?.channel === 'chrome') throw new Error("Chromium distribution 'chrome' is not found at C:\\x");
        return fake;
      }) as never,
    });
    assert.deepEqual(tried, ['chrome', 'msedge']);
    assert.equal(channel, 'msedge');
    // La volta dopo si riparte dal canale che ha creato il profilo.
    tried.length = 0;
    await launchPersistentProfile(dir, { launch: (async (_d: string, o?: { channel?: string }) => { note(o?.channel); return fake; }) as never });
    assert.deepEqual(tried, ['msedge']);
    // Profilo bloccato: niente tentativo con un altro browser, che rovinerebbe i cookie.
    tried.length = 0;
    await assert.rejects(launchPersistentProfile(dir, {
      launch: (async (_d: string, o?: { channel?: string }) => { note(o?.channel); throw new Error('ProcessSingleton'); }) as never,
    }), /ProcessSingleton/);
    assert.deepEqual(tried, ['msedge']);
    assert.equal(isProfileInUseError(new Error('Opening in existing browser session.')), true);
    assert.equal(isMissingChannelError(new Error('ProcessSingleton')), false);
  } finally {
    if (prev !== undefined) process.env.BROWSER_CHANNEL = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('login: profilo già aperto da una scansione → errore chiaro, nessun browser aperto', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hf-lock-'));
  const release = claimProfile(dir)!;
  try {
    assert.equal(claimProfile(dir), null);
    let aperto = false;
    await assert.rejects(
      loginToFacebook(() => {}, { profileDir: dir, statePath: join(dir, 'fb.json'), launch: async () => { aperto = true; throw new Error('no'); } }),
      /scansione di Facebook/,
    );
    assert.equal(aperto, false);
  } finally {
    release();
    rmSync(dir, { recursive: true, force: true });
  }
  // Rilasciato, il profilo torna libero.
  const again = claimProfile(dir);
  assert.ok(again);
  again!();
});

test('login: col profilo dell\'app salva solo i cookie di Facebook, in modo atomico, e libera il profilo', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hf-login-'));
  const statePath = join(dir, 'state', 'fb.json');
  let chiuso = false;
  const page = { url: () => 'https://www.facebook.com/', isClosed: () => false, goto: async () => null };
  const ctx = {
    pages: () => [page],
    newPage: async () => page,
    on: () => {},
    cookies: async () => [{ name: 'c_user', value: '555', domain: '.facebook.com' }],
    storageState: async () => ({
      cookies: [
        { name: 'c_user', value: '555', domain: '.facebook.com', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'None' },
        { name: 'NID', value: 'g', domain: '.google.com', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'None' },
      ],
      origins: [],
    }),
    close: async () => { chiuso = true; },
  } as unknown as BrowserContext;
  try {
    const id = await loginToFacebook(() => {}, { profileDir: join(dir, 'profile'), statePath, launch: async () => ctx });
    assert.equal(id, '555');
    const saved = JSON.parse(readFileSync(statePath, 'utf8')) as { cookies: Array<{ name: string }> };
    assert.deepEqual(saved.cookies.map((c) => c.name), ['c_user']);
    assert.equal(chiuso, true);
    const r = claimProfile(join(dir, 'profile'));
    assert.ok(r, 'il profilo deve tornare libero dopo il login');
    r!();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
