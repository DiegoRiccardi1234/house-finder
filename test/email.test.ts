import test from 'node:test';
import assert from 'node:assert/strict';
import { immobiliareEmail } from '../src/sources/email/immobiliare-email.js';
import { idealistaEmail } from '../src/sources/email/idealista-email.js';

// Mail-notifica finta con link avvolto in un redirect di tracciamento.
const immobiliareHtml = `
  <table><tr><td>
    <a href="https://links.immobiliare.it/x?u=https%3A%2F%2Fwww.immobiliare.it%2Fannunci%2F130105406%2F%3Futm%3Dmail">
      Bilocale via Roma, San Salvario
    </a>
    <div>€ 650 · 55 m² · 2 locali</div>
  </td></tr></table>`;

test('estrae annuncio Immobiliare da mail con link di tracciamento', () => {
  const out = immobiliareEmail.parse(immobiliareHtml, '');
  assert.equal(out.length, 1);
  const l = out[0];
  assert.equal(l.source, 'immobiliare');
  assert.equal(l.id, '130105406');
  assert.equal(l.url, 'https://www.immobiliare.it/annunci/130105406/'); // URL pulito, non il redirect
  assert.equal(l.price, 650);
  assert.equal(l.sizeSqm, 55);
  assert.equal(l.rooms, 2);
});

test('riconosce il mittente', () => {
  assert.equal(immobiliareEmail.matchesSender('noreply@immobiliare.it'), true);
  assert.equal(immobiliareEmail.matchesSender('info@idealista.it'), false);
  assert.equal(idealistaEmail.matchesSender('alerts@idealista.it'), true);
});

test('idealista: link diretto', () => {
  const html = `<a href="https://www.idealista.it/immobili/98765432/">Casa</a><span>€ 500</span>`;
  const out = idealistaEmail.parse(html, '');
  assert.equal(out.length, 1);
  assert.equal(out[0].id, '98765432');
  assert.equal(out[0].price, 500);
});
