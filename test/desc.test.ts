import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDesc as subitoDesc } from '../src/sources/subito.js';
import { buildDesc as immobiliareDesc } from '../src/sources/immobiliare.js';
import { mapRaw } from '../src/sources/idealista.js';

test('subito buildDesc: body + scheda strutturata', () => {
  const d = subitoDesc({
    subject: 'Bilocale',
    body: 'Bel bilocale luminoso, no agenzie.',
    features: {
      '/furnished': { values: [{ value: 'No' }] },
      '/elevator': { values: [{ value: 'Sì' }] },
      '/energy_class': { values: [{ value: 'G' }] },
    },
  })!;
  assert.match(d, /Bel bilocale luminoso/);
  assert.match(d, /SCHEDA:/);
  assert.match(d, /Arredato: No/);
  assert.match(d, /Ascensore: Sì/);
  assert.match(d, /Classe energetica: G/);
});

test('subito buildDesc: senza body né features → null', () => {
  assert.equal(subitoDesc({ subject: 'x' }), null);
});

test('immobiliare buildDesc: caption + description + featureList', () => {
  const d = immobiliareDesc({
    caption: 'Appartamento su due livelli',
    description: 'Ristrutturato e arredato, mai abitato.',
    featureList: [
      { type: 'furniture', label: 'Arredato' },
      { type: 'floor', label: '2º piano' },
    ],
  })!;
  assert.match(d, /Appartamento su due livelli/);
  assert.match(d, /Ristrutturato e arredato/);
  assert.match(d, /SCHEDA: .*Arredato.*2º piano/);
});

test('immobiliare buildDesc: prop assente → null', () => {
  assert.equal(immobiliareDesc(undefined), null);
});

test('idealista mapRaw: snippet descrizione dalla lista', () => {
  const l = mapRaw({
    id: '1',
    href: '/immobile/1/',
    title: 'Bilocale, Crocetta, Torino',
    priceText: '700€/mese',
    details: ['2 locali', '50 m²'],
    description: 'Ideale per studenti o lavoratori, no animali.',
    img: null,
  })!;
  assert.equal(l.desc, 'Ideale per studenti o lavoratori, no animali.');
});
