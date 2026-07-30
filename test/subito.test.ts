import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapItem, type SubitoItem } from '../src/sources/subito.js';

function item(over: Partial<SubitoItem> = {}): SubitoItem {
  return {
    subject: 'Bilocale Crocetta',
    body: 'Bel bilocale arredato in zona tranquilla.',
    urls: { default: 'https://www.subito.it/appartamenti/bilocale-crocetta-torino-123456789.htm' },
    features: {
      '/price': { values: [{ key: '650', value: '650 €' }] },
      '/room': { values: [{ key: '2', value: '2 locali' }] },
      '/size': { values: [{ key: '55', value: '55 m²' }] },
      '/furnished': { values: [{ key: 'yes', value: 'Arredato' }] },
      '/energy_class': { values: [{ key: 'C', value: 'C' }] },
    },
    geo: { town: { value: 'Torino' } },
    images: [{ cdnBaseUrl: 'https://images.sbito.it/api/v1/sbt-ads-images-pro/images/60/abc' }],
    ...over,
  };
}

test('subito mapItem: campi base da features + id da URL', () => {
  const l = mapItem(item())!;
  assert.equal(l.source, 'subito');
  assert.equal(l.id, '123456789'); // dall'URL -<id>.htm
  assert.equal(l.price, 650);
  assert.equal(l.rooms, 2);
  assert.equal(l.sizeSqm, 55);
  assert.equal(l.zone, 'Torino');
  // thumb = cdnBaseUrl + ?rule= (il base grezzo è 400; il rule lo rende servibile)
  assert.equal(l.thumb, 'https://images.sbito.it/api/v1/sbt-ads-images-pro/images/60/abc?rule=large-fixed-card-1x-auto');
  assert.match(l.desc ?? '', /bilocale arredato/i);
  assert.match(l.desc ?? '', /SCHEDA:/); // include i campi strutturati
});

test('subito mapItem: senza URL → null', () => {
  assert.equal(mapItem(item({ urls: {} })), null);
});

test('subito mapItem: prezzo/locali assenti → null (non 0)', () => {
  const l = mapItem(item({ features: {} }))!;
  assert.equal(l.price, null);
  assert.equal(l.rooms, null);
  assert.equal(l.sizeSqm, null);
});
