import test from 'node:test';
import assert from 'node:assert/strict';
import { immobiliareEmail } from '../src/sources/email/immobiliare-email.js';
import { idealistaEmail } from '../src/sources/email/idealista-email.js';
import { createEmailLinkResolver } from '../src/sources/email/tracking-links.js';

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

const card = (href: string) => `<div><a href="${href}">Bilocale in via Esempio</a><span>850 € · 50 m² · 2 locali</span></div>`;
const tracked = (id: string) => `https://l.settimanale.idealista.it/rts/${id}`;

test('idealista: percorso attuale singolare e prezzo prima del simbolo', () => {
  const out = idealistaEmail.parse(card('https://www.idealista.it/immobile/10101/'), '');
  assert.equal(out[0].id, '10101');
  assert.equal(out[0].price, 850);
});

test('email: HEAD manuale recupera il wrapper verificato e si ferma prima del dettaglio', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
    calls.push(url.href);
    assert.equal(init.method, 'HEAD');
    assert.equal(init.redirect, 'manual');
    assert.ok(init.signal);
    return new Response(null, { status: 302, headers: { location: 'https://www.idealista.it/immobile/20202/?utm_source=example' } });
  });
  const html = card(tracked('invented-head')) + card(tracked('invented-head'));
  const result = await idealistaEmail.resolve!(html, '', createEmailLinkResolver());
  assert.equal(result.complete, true);
  assert.equal(result.unresolved, 0);
  assert.equal(result.listings.length, 1);
  assert.equal(result.listings[0].url, 'https://www.idealista.it/immobile/20202/');
  assert.equal(result.listings[0].sizeSqm, 50);
  assert.equal(calls.length, 1);
  const second = await idealistaEmail.resolve!(html, '', createEmailLinkResolver());
  assert.equal(second.complete, true);
  assert.equal(calls.length, 1, 'cache tra run evita nuove richieste');
});

test('email: footer e azioni non sono visitati; redirect esterni e login non vengono seguiti', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: calls === 1 ? 'https://www.idealista.it/login?magic=example' : 'https://external.invalid/immobile/30303/' } });
  });
  const resolver = createEmailLinkResolver();
  const html = `<a href="${tracked('invented-footer')}">Disiscriviti</a><a href="${tracked('invented-news')}">Leggi le notizie</a>`;
  await idealistaEmail.resolve!(html, '', resolver);
  assert.equal(calls, 0);
  assert.equal(await resolver.resolve(tracked('invented-blocked-first'), 'idealista'), null);
  assert.equal(await resolver.resolve(tracked('invented-external'), 'idealista'), null);
  assert.equal(calls, 2);
  assert.equal(await resolver.resolve('http://l.settimanale.idealista.it/rts/insecure', 'idealista'), null);
  assert.equal(await resolver.resolve('https://evil.idealista.it/rts/unknown', 'idealista'), null);
  assert.equal(calls, 2);
});

test('email: budget conserva annunci validi e segnala mail incompleta', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: 'https://www.idealista.it/immobile/40404/' } });
  });
  const resolver = createEmailLinkResolver({ maxRequests: 1 });
  const html = card(tracked('invented-budget-a')) + card(tracked('invented-budget-b'));
  const result = await idealistaEmail.resolve!(html, '', resolver);
  assert.equal(result.listings.length, 1);
  assert.equal(result.complete, false);
  assert.equal(result.unresolved, 1);
  assert.equal(resolver.stats.exhausted, true);
  assert.equal(calls, 1);
});

test('email: tre hop massimo e fallimenti temporanei in cache', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: tracked(`invented-hop-${calls}`) } });
  });
  const href = tracked('invented-hop-start');
  assert.equal(await createEmailLinkResolver().resolve(href, 'idealista'), null);
  assert.equal(calls, 3);
  assert.equal(await createEmailLinkResolver().resolve(href, 'idealista'), null);
  assert.equal(calls, 3);
});

test('email: concorrenza limitata a tre HEAD e guasto rete senza esporre URL', async (t) => {
  let active = 0, peak = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    throw new Error('errore di rete con URL privato');
  });
  const resolver = createEmailLinkResolver();
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => resolver.resolve(tracked(`invented-concurrency-${i}`), 'idealista')));
  assert.deepEqual(results, Array(8).fill(null));
  assert.equal(peak, 3);
});
