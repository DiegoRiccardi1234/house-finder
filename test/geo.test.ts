import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { haversineKm, insidePolygon } from '../src/core/geo.js';
import { bboxOf, geocodeAddress, precisionOf, resetGeocoder, streetFromText } from '../src/core/geocode.js';
import { normConflict } from '../src/ai/score.js';

test('streetFromText: titoli veri del 26/11 (Subito, Immobiliare, Idealista)', () => {
  const casi: Array<[string, string | null]> = [
    ['VIA GORIZIA DECOROSO E GRAZIOSO BILOCALE NUOVO', 'via gorizia'],
    ['MONOLOCALE LUMINOSO VIA VENTIMIGLIA', 'via ventimiglia'],
    ['CORSO TRAPANI ALLOGGIO CON BOX', 'corso trapani'],
    ['BILOCALE VIA CESANA', 'via cesana'],
    ['CORSO GALILEO FERRARIS BILOCALE NUOVO', 'corso galileo ferraris'],
    ['Bilocale in Via Brione, Campidoglio, Torino', 'via brione'],
    ['Bilocale corso Spezia, 55, Nizza Millefonti, Torino', 'corso spezia 55'],
    ['Monolocale via Andrea Massena 18, Crocetta, Torino', 'via andrea massena 18'],
    ["Monolocale in Via Sant'Antonio da Padova, 14, Centro", "via sant'antonio da padova 14"],
    ['MONOLOCALE SPAZIOSO : C.SO SICCARDI', 'corso siccardi'],
    ['ALLOGGIO CON TERRAZZINO   CROCEETTA', null],
    ['bilocale arredato comodo al Politecnico', null],
    ['', null],
  ];
  for (const [titolo, atteso] of casi) assert.equal(streetFromText(titolo), atteso, titolo);
});

test('normConflict: anche booleani e "sì"', () => {
  assert.equal(normConflict(true), 'si');
  assert.equal(normConflict(false), 'no');
  // Regressione 1.9.0: un byte di controllo nella regex faceva fallire proprio "si".
  assert.equal(normConflict('si'), 'si');
  assert.equal(normConflict('Sì'), 'si');
  assert.equal(normConflict('sì, solo studenti'), 'si');
  assert.equal(normConflict('forse'), 'forse');
  assert.equal(normConflict(null), null);
  // Risposta non riconosciuta: un dubbio, mai uno scarto.
  assert.equal(normConflict('possibile'), 'forse');
  assert.equal(normConflict('n/d'), 'forse');
  assert.equal(normConflict('nessuno'), 'no');
  assert.equal(normConflict('non in conflitto'), 'no');
});

test('normalizzatori AI: arredato e ascensore letti a parole intere', async () => {
  const { normArredato, normBool } = await import('../src/ai/score.js');
  assert.equal(normArredato('arredato moderno'), 'sì');
  assert.equal(normArredato('arredato, in buono stato'), 'sì');
  assert.equal(normArredato('no'), 'no');
  assert.equal(normArredato('non arredato'), 'no');
  assert.equal(normArredato('parzialmente arredato'), 'parziale');
  assert.equal(normBool('senza ascensore'), false);
  assert.equal(normBool('sì'), true);
  assert.equal(normBool('si, con ascensore'), true);
  assert.equal(normBool('no'), false);
});
import { groupCityOf, textSignature } from '../src/core/state.js';
import { mergeRepostedFb } from '../src/core/pipeline.js';
import { ListingStore } from '../src/core/store.js';
import { citySlugOf } from '../src/config/cities.js';
import { floorKind, queryListings } from '../src/server/listingQuery.js';
import type { StoredListing } from '../src/core/store.js';
import type { Profile } from '../src/config/profile.js';

const CSI = { lat: 45.03822, lng: 7.65225 };

test('haversine: Porta Nuova – CSI circa 3,6 km', () => {
  const km = haversineKm({ lat: 45.0621, lng: 7.6786 }, CSI);
  assert.ok(km > 3.2 && km < 3.9, `km=${km}`);
});

test('punto nel poligono', () => {
  const sq: [number, number][] = [[45, 7], [46, 7], [46, 8], [45, 8]];
  assert.equal(insidePolygon({ lat: 45.5, lng: 7.5 }, sq), true);
  assert.equal(insidePolygon({ lat: 46.5, lng: 7.5 }, sq), false);
  assert.equal(insidePolygon({ lat: 45.5, lng: 7.5 }, sq.slice(0, 2)), false);
});

test('bbox del poligono con margine', () => {
  const b = bboxOf([[45, 7], [45.1, 7], [45.1, 7.1]], 0)!;
  assert.deepEqual(b.map((n) => Math.round(n * 10) / 10), [45, 7, 45.1, 7.1]);
});

test('precisione dei risultati Nominatim', () => {
  assert.equal(precisionOf({ addresstype: 'building' }), 'address');
  assert.equal(precisionOf({ addresstype: 'road' }), 'street');
  assert.equal(precisionOf({ addresstype: 'suburb' }), 'zone');
  // Civico interpolato, risposta vera di Nominatim per "Via Cavour 10, Torino" (26/11).
  assert.equal(precisionOf({ addresstype: 'place', type: 'house', class: 'place' }), 'address');
});

test('geocoder: cache su disco anche dei vuoti, una sola richiesta per indirizzo', async () => {
  resetGeocoder();
  const cachePath = join(tmpdir(), `geocache-${process.pid}-${Date.now()}.json`);
  const urls: string[] = [];
  const fetchFn = (async (url: string) => {
    urls.push(url);
    const body = url.includes('Passo+Buole') ? [{ lat: '45.03', lon: '7.64', addresstype: 'road' }] : [];
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  const opts = { fetchFn, cachePath, delayMs: 0 };
  const a = await geocodeAddress('via Passo Buole 10', 'Torino', [45, 7.6, 45.1, 7.7], opts);
  assert.deepEqual(a, { lat: 45.03, lng: 7.64, precision: 'street', source: 'geocode' });
  assert.match(urls[0]!, /viewbox=7\.6%2C45\.1%2C7\.7%2C45&bounded=1/);
  assert.equal(await geocodeAddress('via Inesistente 1', 'Torino', null, opts), null);
  await geocodeAddress('Via Passo Buole 10', 'Torino', null, opts);
  await geocodeAddress('via inesistente 1', 'torino', null, opts);
  assert.equal(urls.length, 2);
});

test('geocoder: una voce "di quartiere" della 1.9.0 in cache si rifà, una nuova no', async () => {
  resetGeocoder();
  const cachePath = join(tmpdir(), `geocache-v1-${process.pid}-${Date.now()}.json`);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(cachePath, JSON.stringify({ 'via cavour 10 torino': { point: { lat: 45.06, lng: 7.68, precision: 'zone', source: 'geocode' }, at: 'x' } }));
  let calls = 0;
  const fetchFn = (async () => { calls++; return new Response(JSON.stringify([{ lat: '45.0652', lon: '7.6830', addresstype: 'place', type: 'house' }]), { status: 200 }); }) as unknown as typeof fetch;
  const opts = { fetchFn, cachePath, delayMs: 0 };
  assert.equal((await geocodeAddress('Via Cavour 10', 'Torino', null, opts))?.precision, 'address');
  assert.equal((await geocodeAddress('Via Cavour 10', 'Torino', null, opts))?.precision, 'address');
  assert.equal(calls, 1);
});

test('geocoder: servizio giù non solleva e non mette in cache', async () => {
  resetGeocoder();
  const cachePath = join(tmpdir(), `geocache-down-${process.pid}-${Date.now()}.json`);
  let calls = 0;
  const fetchFn = (async () => { calls++; return new Response('no', { status: 503 }); }) as unknown as typeof fetch;
  assert.equal(await geocodeAddress('via Roma 1', 'Torino', null, { fetchFn, cachePath, delayMs: 0 }), null);
  assert.equal(await geocodeAddress('via Roma 1', 'Torino', null, { fetchFn, cachePath, delayMs: 0 }), null);
  assert.equal(calls, 2);
});

test('città dal testo e dal prefisso del gruppo FB', () => {
  assert.equal(citySlugOf('Torino'), 'torino');
  assert.equal(citySlugOf('Torino (TO)'), 'torino');
  assert.equal(citySlugOf('Reggio Calabria'), 'reggio-calabria');
  assert.equal(citySlugOf('Atlantide'), null);
  assert.equal(groupCityOf({ desc: '[Affitti Torino Privati · torino] Bilocale...' }), 'torino');
});

const POST = 'Si liberano dal 1 gennaio camera indipendente/monolocale una in via Passo Buole e una in corso Trapani, arredate, contratto regolare, spese incluse';

test('firma del testo: uguale fra gruppi, nulla se il post è corto', () => {
  const a = textSignature({ desc: `[Gruppo A · torino] ${POST}` });
  const b = textSignature({ desc: `[Gruppo B · torino] ${POST.toUpperCase()}!!` });
  assert.ok(a);
  assert.equal(a, b);
  assert.equal(textSignature({ desc: '[G · torino] Affitto bilocale, scrivimi' }), null);
});

test('stesso post in più gruppi: uno solo in archivio, gli altri in alsoIn', async () => {
  const store = await ListingStore.load(join(tmpdir(), `merge-${process.pid}-${Date.now()}.json`));
  const mk = (id: string, g: string) => ({ source: 'fb-group', id, url: `https://fb/${id}`, title: 'Monolocale', price: null, desc: `[${g} · torino] ${POST}` });
  store.upsert(mk('1', 'A'), '2026-11-26T10:00:00.000Z');
  const { kept, merged } = mergeRepostedFb([mk('1', 'A'), mk('2', 'B'), mk('3', 'C')], store);
  assert.equal(merged, 2);
  assert.deepEqual(kept.map((l) => l.id), ['1']);
  assert.deepEqual(store.get('fb-group:1')?.alsoIn, ['https://fb/2', 'https://fb/3']);
});

test('piano: tre classi dal testo libero', () => {
  assert.equal(floorKind('T'), 'terra');
  assert.equal(floorKind('rialzato'), 'terra');
  assert.equal(floorKind('3° di 5'), 'intermedio');
  assert.equal(floorKind('5 di 5'), 'ultimo');
  assert.equal(floorKind('ultimo piano'), 'ultimo');
  assert.equal(floorKind(null), null);
});

function row(id: string, over: Partial<StoredListing> = {}, f: Record<string, unknown> = {}): StoredListing {
  return {
    key: `x:${id}`,
    listing: { source: 'x', id, url: `u${id}`, title: `Casa ${id}`, price: 600 },
    ai: { score: 50, verdict: '', pros: [], cons: [], worthVisit: false },
    fields: { citta: 'Torino', locali: 2, bagni: 1, piano: '2', ascensore: true, ...f } as StoredListing['fields'],
    visionSummary: null, photos: [], channel: 'subito', firstSeen: '2026-11-26T10:00:00.000Z', lastSeen: '', status: 'new', notified: false,
    city: 'torino', ...over,
  };
}

const P: Profile = {
  searches: [{ id: 'b', city: 'torino', label: 'Torino · bilocale', maxPrice: 700 }],
  zones: [{ city: 'torino', keep: [], avoid: [], riferimento: { label: 'Lavoro', address: 'CSI', ...CSI }, area: { polygon: [[45.02, 7.63], [45.06, 7.63], [45.06, 7.68], [45.02, 7.68]] } }],
  musts: [], notes: '',
};

test('filtri: stato «Da vedere» nasconde gli scartati, «Da chiedere» mostra solo i bollini', () => {
  const all = [row('1'), row('2', { status: 'dismissed' }), row('3', { askOwner: { reason: 'solo studenti' } })];
  assert.deepEqual(queryListings(all, { status: 'active' }, P).map((r) => r.key), ['x:1', 'x:3']);
  assert.deepEqual(queryListings(all, { status: 'ask' }, P).map((r) => r.key), ['x:3']);
});

test('filtri: prezzo e locali, con il dato mancante che passa', () => {
  const all = [row('1'), row('2', { listing: { source: 'x', id: '2', url: 'u2', title: 'c', price: 900 } }), row('3', { listing: { source: 'x', id: '3', url: 'u3', title: 'c', price: null } }, { locali: 3 })];
  assert.deepEqual(queryListings(all, { priceMin: '500', priceMax: '700' }, P).map((r) => r.key).sort(), ['x:1', 'x:3']);
  assert.deepEqual(queryListings(all, { rooms: '1,2' }, P).map((r) => r.key).sort(), ['x:1', 'x:2']);
  assert.deepEqual(queryListings(all, { rooms: '4' }, P).map((r) => r.key), []);
});

test('filtri: caratteristiche solo se dichiarate, distanza e area', () => {
  const vicino = row('1', { geo: { lat: 45.04, lng: 7.65, precision: 'street', source: 'geocode' } });
  const lontano = row('2', { geo: { lat: 45.07, lng: 7.69, precision: 'street', source: 'geocode' } }, { ascensore: null });
  const ignoto = row('3');
  const out = queryListings([vicino, lontano, ignoto], { sort: 'distance' }, P);
  assert.deepEqual(out.map((r) => r.key), ['x:1', 'x:2', 'x:3']);
  assert.ok(out[0]!.distanceKm! < 0.5);
  assert.deepEqual(queryListings([vicino, lontano, ignoto], { ascensore: '1' }, P).map((r) => r.key), ['x:1', 'x:3']);
  assert.deepEqual(queryListings([vicino, lontano, ignoto], { maxKm: '2' }, P).map((r) => r.key).sort(), ['x:1', 'x:3']);
  assert.deepEqual(queryListings([vicino, lontano, ignoto], { maxKm: '2', withoutGeo: '0' }, P).map((r) => r.key), ['x:1']);
  assert.deepEqual(queryListings([vicino, lontano, ignoto], { inArea: '1' }, P).map((r) => r.key).sort(), ['x:1', 'x:3']);
});

test('coordinate dei portali: Immobiliare con via = via; Subito solo da zoom 16', async () => {
  const { immGeo } = await import('../src/sources/immobiliare.js');
  const { subitoGeo, subito } = await import('../src/sources/subito.js');
  const { immobiliare } = await import('../src/sources/immobiliare.js');
  assert.deepEqual(immGeo({ address: 'Via Genova', latitude: 45.0169, longitude: 7.663, marker: 'marker' }), { lat: 45.0169, lng: 7.663, precision: 'street', source: 'portal' });
  assert.equal(immGeo({ latitude: 45.0169, longitude: 7.663 })?.precision, 'zone');
  assert.equal(immGeo({}), null);
  assert.equal(subitoGeo({ geo: { map: { latitude: '45.0651816', longitude: '7.6829721', zoom: '13' } } }), null);
  assert.equal(subitoGeo({ geo: { map: { latitude: '45.0544', longitude: '7.6566', zoom: '18' } } })?.precision, 'street');
  const p = { id: 'b', city: 'torino', label: 'Torino · bilocale', maxPrice: 700, minRooms: 2, maxRooms: 2 };
  assert.match(immobiliare.buildUrl(p), /localiMinimo=2&localiMassimo=2/);
  assert.match(subito.buildUrl(p), /rs=2&re=2/);
});
