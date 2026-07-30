import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapRaw, type RawCard } from '../src/sources/idealista.js';

test('idealista mapRaw: campi base + zona dal titolo', () => {
  const l = mapRaw({
    id: '36245588',
    href: '/immobile/36245588/',
    title: 'Bilocale in Via Aurelio Saffi, 24, Cit Turin, Torino',
    priceText: '700€/mese',
    details: ['2 locali', '45 m²', '4º piano con ascensore'],
    description: null,
    img: 'https://img4.idealista.it/x.jpg',
  })!;
  assert.equal(l.source, 'idealista');
  assert.equal(l.id, '36245588');
  assert.equal(l.url, 'https://www.idealista.it/immobile/36245588/');
  assert.equal(l.price, 700);
  assert.equal(l.sizeSqm, 45);
  assert.equal(l.rooms, 2);
  assert.equal(l.zone, 'Cit Turin');
  assert.equal(l.thumb, 'https://img4.idealista.it/x.jpg');
});

test('idealista mapRaw: prezzo migliaia, id da href, img nulla', () => {
  const l = mapRaw({
    id: null,
    href: '/immobile/999/',
    title: 'Trilocale, Centro, Torino',
    priceText: '1.200€/mese',
    details: ['3 locali', '80 m²'],
    description: null,
    img: null,
  })!;
  assert.equal(l.id, '999');
  assert.equal(l.price, 1200);
  assert.equal(l.rooms, 3);
  assert.equal(l.sizeSqm, 80);
  assert.equal(l.zone, 'Centro');
  assert.equal(l.thumb, null);
});

test('idealista mapRaw: card senza href/id → scartata', () => {
  const bad: RawCard = { id: null, href: null, title: '', priceText: '', details: [], description: null, img: null };
  assert.equal(mapRaw(bad), null);
});

test('idealista mapRaw: prezzo assente → null, non crasha', () => {
  const l = mapRaw({
    id: '5',
    href: '/immobile/5/',
    title: 'Monolocale in Via Test, Madonnella, Bari',
    priceText: '',
    details: [],
    description: null,
    img: null,
  })!;
  assert.equal(l.price, null);
  assert.equal(l.rooms, null);
  assert.equal(l.sizeSqm, null);
  assert.equal(l.zone, 'Madonnella'); // penultimo segmento (ultimo = città)
});
