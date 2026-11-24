import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loginComplete } from '../src/sources/fb-login.js';
import { INSTALLED_CHANNELS } from '../src/core/browser.js';

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

test('browser installato preferito: prima Chrome, poi Edge', () => {
  assert.deepEqual([...INSTALLED_CHANNELS], ['chrome', 'msedge']);
});
