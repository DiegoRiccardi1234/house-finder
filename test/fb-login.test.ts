import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loginComplete } from '../src/sources/fb-login.js';
import { INSTALLED_CHANNELS } from '../src/core/browser.js';
import { braveAvailable, bravePaths, importFacebookFromBrave } from '../src/sources/fb-import.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
