import test from 'node:test';
import assert from 'node:assert/strict';
import { matches, isResidential } from '../src/core/match.js';
import type { Listing, SearchProfile } from '../src/core/types.js';

const bilocale: SearchProfile = {
  id: 't',
  city: 'torino',
  label: 'Torino bilocale',
  maxPrice: 700,
  minRooms: 2,
  maxRooms: 2,
};

function listing(over: Partial<Listing>): Listing {
  return { source: 's', id: '1', url: 'u', title: 't', price: null, ...over };
}

test('esclude sopra il prezzo massimo', () => {
  assert.equal(matches(listing({ price: 900, rooms: 2 }), bilocale), false);
});

test('accetta un annuncio in target', () => {
  assert.equal(matches(listing({ price: 650, rooms: 2 }), bilocale), true);
});

test('prezzo sconosciuto non esclude', () => {
  assert.equal(matches(listing({ price: null, rooms: 2 }), bilocale), true);
});

test('esclude fuori range locali', () => {
  assert.equal(matches(listing({ price: 600, rooms: 4 }), bilocale), false);
});

test('locali sconosciuti non escludono', () => {
  assert.equal(matches(listing({ price: 600, rooms: null }), bilocale), true);
});

test('isResidential: scarta posti auto/box/garage', () => {
  assert.equal(isResidential(listing({ title: 'Appartamento Bari [LocazionepostoautoARG]' })), false);
  assert.equal(isResidential(listing({ title: 'Posto auto coperto in centro' })), false);
  assert.equal(isResidential(listing({ title: 'Box auto / garage' })), false);
  assert.equal(isResidential(listing({ title: 'Magazzino uso deposito' })), false);
});

test('isResidential: tiene le case (anche con box)', () => {
  assert.equal(isResidential(listing({ title: 'Bilocale arredato con box auto' })), true);
  assert.equal(isResidential(listing({ title: 'Trilocale luminoso in Crocetta' })), true);
  assert.equal(isResidential(listing({ title: 'Monolocale, posto auto incluso' })), true); // ha "monolocale"
  assert.equal(isResidential(listing({ title: 'Appartamento con garage' })), true); // ha "appartament"
});
