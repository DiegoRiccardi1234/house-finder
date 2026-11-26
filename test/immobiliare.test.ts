import { test } from 'node:test';
import assert from 'node:assert/strict';
import { immGeo, mapResult, parseNextData, type ImmResult } from '../src/sources/immobiliare.js';

test('immobiliare immGeo: via + marker = via; senza via = quartiere; coordinate assenti o 0,0 = nessuna', () => {
  assert.deepEqual(immGeo({ latitude: 45.0451, longitude: 7.6512, address: 'via Tripoli', marker: 'marker' }),
    { lat: 45.0451, lng: 7.6512, precision: 'street', source: 'portal' });
  assert.equal(immGeo({ latitude: 45.0451, longitude: 7.6512 })?.precision, 'zone');
  assert.equal(immGeo({ latitude: 45.0451, longitude: 7.6512, address: 'via Tripoli', marker: 'area' })?.precision, 'zone');
  assert.equal(immGeo({ latitude: 0, longitude: 0, address: 'x' }), null);
  assert.equal(immGeo({ address: 'via Tripoli' }), null);
  assert.equal(immGeo(undefined), null);
});

function result(over: Partial<ImmResult['realEstate']> = {}): ImmResult {
  return {
    seo: { url: 'https://www.immobiliare.it/annunci/111/' },
    realEstate: {
      id: 111,
      title: 'Trilocale San Salvario',
      price: { value: 800 },
      properties: [
        {
          rooms: '3',
          surface: '90 m²',
          caption: 'Ampio trilocale luminoso',
          featureList: [{ label: 'Arredato' }, { label: 'Ascensore' }],
          multimedia: { photos: [{ urls: { large: 'https://img/l.jpg', small: 'https://img/s.jpg' } }] },
          location: { microzone: 'San Salvario' },
        },
      ],
      ...over,
    },
  };
}

test('immobiliare mapResult: campi base + thumb large + desc con SCHEDA', () => {
  const l = mapResult(result())!;
  assert.equal(l.source, 'immobiliare');
  assert.equal(l.id, '111');
  assert.equal(l.price, 800);
  assert.equal(l.rooms, 3);
  assert.equal(l.sizeSqm, 90); // firstDigits('90 m²')
  assert.equal(l.zone, 'San Salvario');
  assert.equal(l.thumb, 'https://img/l.jpg'); // preferisce large
  assert.match(l.desc ?? '', /Ampio trilocale/);
  assert.match(l.desc ?? '', /SCHEDA: Arredato · Ascensore/);
});

test('immobiliare mapResult: firstDigits su formati sporchi', () => {
  const l = mapResult(result({ properties: [{ rooms: '5+', surface: 'trilocale, 90 m²' }] } as never))!;
  assert.equal(l.rooms, 5); // "5+" → 5
  assert.equal(l.sizeSqm, 90); // prima sequenza di cifre
});

test('immobiliare mapResult: senza url/id/realEstate → null', () => {
  assert.equal(mapResult({ seo: {}, realEstate: { id: 1 } }), null); // manca url
  assert.equal(mapResult({ seo: { url: 'x' } }), null); // manca realEstate
});

test('immobiliare: trova results anche dopo altre query; distingue lista vuota da schema cambiato', () => {
  const data = (results: ImmResult[]) => ({ props: { pageProps: { dehydratedState: { queries: [
    { state: { data: {} } }, { state: { data: { results } } },
  ] } } } });
  assert.equal(parseNextData(data([result()])).length, 1);
  assert.deepEqual(parseNextData(data([])), []);
  assert.throws(() => parseNextData({ props: { pageProps: {} } }), /results assente/);
  assert.throws(() => parseNextData(data([{}])), /nessun annuncio riconosciuto/);
});
