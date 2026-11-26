import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyRules, checkRules, isRoomOffer } from '../src/core/rules.js';
import { ListingStore, type StoredListing } from '../src/core/store.js';
import type { ListingFields } from '../src/core/types.js';
import type { Profile } from '../src/config/profile.js';

const NOW = '2026-11-26T10:00:00.000Z';

const fields = (over: Partial<ListingFields> = {}): ListingFields => ({
  citta: 'Torino', zona: null, tipologia: 'bilocale', prezzo: null, spese: null, m2: null, locali: 2, bagni: null,
  piano: null, ascensore: null, arredato: 'sì', classe_energetica: null, riscaldamento: null, aria_condizionata: null,
  disponibile_da: null, tipo_contratto: null, vincoli_inquilino: [], contatto: null, riassunto: null, ...over,
});

function rec(over: Partial<StoredListing> = {}, f: Partial<ListingFields> = {}): StoredListing {
  return {
    key: `x:${Math.random()}`,
    listing: { source: 'fb-group', id: '1', url: 'https://fb/1', title: 'Bilocale', price: 600 },
    ai: { score: 50, verdict: '', pros: [], cons: [], worthVisit: false },
    fields: fields(f),
    visionSummary: null, photos: [], channel: 'facebook', firstSeen: NOW, lastSeen: NOW, status: 'new', notified: false,
    city: 'torino',
    ...over,
  };
}

// Un quadrato attorno al CSI (Corso Unione Sovietica 216).
const AREA: [number, number][] = [[45.02, 7.63], [45.06, 7.63], [45.06, 7.68], [45.02, 7.68]];

const profile = (over: Partial<Profile> = {}): Profile => ({
  searches: [
    { id: 'm', city: 'torino', label: 'Torino · monolocale', maxPrice: 700, minRooms: 1, maxRooms: 1, tipo: 'monolocale' },
    { id: 'b', city: 'torino', label: 'Torino · bilocale', maxPrice: 700, minRooms: 2, maxRooms: 2, tipo: 'bilocale' },
  ],
  zones: [{ city: 'torino', keep: [], avoid: [], area: { polygon: AREA } }],
  musts: [], notes: '',
  tenant: { occupazione: 'lavoratore' },
  ...over,
});

test('trilocale: scartato con motivo leggibile', () => {
  const v = checkRules(rec({}, { locali: 3, tipologia: 'trilocale' }), profile());
  assert.equal(v?.rule, 'locali');
  assert.match(v!.reason, /trilocale: cerchi monolocale o bilocale/);
});

test('locali ignoti: in dubbio non si scarta', () => {
  assert.equal(checkRules(rec({}, { locali: null, tipologia: null }), profile()), null);
});

test('stanza in casa condivisa: scartata se nessuna ricerca è di stanze', () => {
  assert.equal(checkRules(rec({}, { tipologia: 'stanza singola in appartamento condiviso', locali: null }), profile())?.rule, 'stanza');
  assert.equal(checkRules(rec({}, { tipologia: 'posto letto', locali: null }), profile())?.rule, 'stanza');
  // Un monolocale che si chiama "camera indipendente" non è una stanza in casa d'altri.
  assert.equal(isRoomOffer('camera indipendente/monolocale'), false);
  const conStanze = profile({ searches: [{ id: 's', city: 'torino', label: 'Torino · stanza', maxPrice: 650, tipo: 'stanza' }] });
  assert.equal(checkRules(rec({}, { tipologia: 'stanza singola', locali: null }), conStanze), null);
});

test('vendita o casa vacanza: non è un affitto', () => {
  assert.equal(checkRules(rec({}, { tipologia: 'appartamento in vendita' }), profile())?.rule, 'tipo');
  assert.equal(checkRules(rec({}, { tipologia: 'casa vacanza' }), profile())?.rule, 'tipo');
});

test('prezzo oltre il tetto: scartato; prezzo ignoto: tenuto', () => {
  const caro = rec({ listing: { source: 'x', id: '1', url: 'u', title: 't', price: 820 } });
  assert.match(checkRules(caro, profile())!.reason, /820 €: oltre il tetto di 700/);
  const ignoto = rec({ listing: { source: 'x', id: '1', url: 'u', title: 't', price: null } });
  assert.equal(checkRules(ignoto, profile()), null);
});

test('area: fuori solo se la posizione è precisa', () => {
  const fuori = rec({ geo: { lat: 45.07, lng: 7.68, precision: 'address', source: 'geocode' } });
  assert.equal(checkRules(fuori, profile())?.rule, 'area');
  const dentro = rec({ geo: { lat: 45.04, lng: 7.65, precision: 'street', source: 'geocode' } });
  assert.equal(checkRules(dentro, profile()), null);
  const approssimata = rec({ geo: { lat: 45.07, lng: 7.68, precision: 'zone', source: 'portal' } });
  assert.equal(checkRules(approssimata, profile()), null);
});

test('solo studenti: voto basso scartato, voto alto «da chiedere»', () => {
  const basso = rec({ ai: { score: 40, verdict: '', pros: [], cons: [], worthVisit: false } }, { conflitto_inquilino: 'si', motivo_conflitto: 'solo studenti' });
  const alto = rec({ ai: { score: 80, verdict: '', pros: [], cons: [], worthVisit: true } }, { conflitto_inquilino: 'si', motivo_conflitto: 'solo studenti' });
  const forse = rec({}, { conflitto_inquilino: 'forse' });
  const r = applyRules([basso, alto, forse], profile(), NOW);
  assert.deepEqual(r, { dismissed: 1, restored: 0, ask: 1 });
  assert.equal(basso.status, 'dismissed');
  assert.deepEqual(basso.auto, { rule: 'inquilino', reason: 'solo studenti', at: NOW });
  assert.equal(alto.status, 'new');
  assert.deepEqual(alto.askOwner, { reason: 'solo studenti' });
  assert.equal(forse.status, 'new');
});

test('senza «chi cerca casa» il conflitto inquilino non scarta niente', () => {
  const r = rec({}, { conflitto_inquilino: 'si' });
  applyRules([r], profile({ tenant: null }), NOW);
  assert.equal(r.status, 'new');
});

test('mai sopra l\'utente: preferiti e scarti manuali restano', () => {
  const preferito = rec({ status: 'favorite' }, { locali: 3 });
  const scartatoAMano = rec({ status: 'dismissed' }, { locali: 2 });
  applyRules([preferito, scartatoAMano], profile(), NOW);
  assert.equal(preferito.status, 'favorite');
  assert.equal(scartatoAMano.status, 'dismissed');
  assert.equal(scartatoAMano.auto, undefined);
});

test('profilo cambiato: lo scarto automatico torna fra i nuovi', () => {
  const tri = rec({}, { locali: 3 });
  applyRules([tri], profile(), NOW);
  assert.equal(tri.status, 'dismissed');
  const conTrilocali = profile({ searches: [...profile().searches, { id: 't', city: 'torino', label: 'Torino · trilocale', maxPrice: 900, minRooms: 3, maxRooms: 3 }] });
  const r = applyRules([tri], conTrilocali, NOW);
  assert.equal(r.restored, 1);
  assert.equal(tri.status, 'new');
  assert.equal(tri.auto, undefined);
});

test('store: i campi nuovi sopravvivono alla scansione successiva, setStatus toglie auto', async () => {
  const s = await ListingStore.load(join(tmpdir(), `rules-store-${process.pid}-${Date.now()}.json`));
  const l = { source: 'subito', id: '9', url: 'u', title: 'Bilocale', price: 600 };
  const r = s.upsert(l, NOW, { city: 'torino', geo: { lat: 45, lng: 7.6, precision: 'street', source: 'geocode' } });
  r.auto = { rule: 'area', reason: 'fuori', at: NOW };
  r.askOwner = { reason: 'solo studenti' };
  r.alsoIn = ['https://fb/2'];
  const again = s.upsert(l, '2026-11-27T10:00:00.000Z');
  assert.equal(again.city, 'torino');
  assert.equal(again.geo?.precision, 'street');
  assert.equal(again.auto?.rule, 'area');
  assert.deepEqual(again.alsoIn, ['https://fb/2']);
  assert.equal(s.setStatus(again.key, 'new'), true);
  assert.equal(s.get(again.key)?.auto, undefined);
  assert.deepEqual(s.get(again.key)?.askOwner, { reason: 'solo studenti' });
});
