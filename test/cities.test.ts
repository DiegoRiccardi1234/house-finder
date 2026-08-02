import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CITIES, cityPath, findCity, isKnownCity, UnknownCityError } from '../src/config/cities.js';
import { subito } from '../src/sources/subito.js';
import { immobiliare } from '../src/sources/immobiliare.js';
import { idealista } from '../src/sources/idealista.js';
import type { SearchProfile } from '../src/core/types.js';

/**
 * Il registro delle città.
 *
 * Il difetto che questi test impediscono non dava errore: la città era testo libero nella UI ma
 * una mappa da due voci nel motore, e `CITY_PATH['milano']` = `undefined` produceva
 * `https://www.subito.it/undefined`. Nessuna eccezione, nessun log, solo una scansione che gira
 * e non trova mai niente.
 */

const profilo = (city: string): SearchProfile => ({
  id: `${city}-test`,
  city,
  label: 'test',
  maxPrice: 700,
});

test('una città sconosciuta si ferma invece di produrre un indirizzo rotto', () => {
  assert.throws(() => cityPath('atlantide', 'subito'), UnknownCityError);
  // E lo stesso vale dal punto in cui il guasto nasceva davvero.
  assert.throws(() => subito.buildUrl(profilo('atlantide')), UnknownCityError);
  assert.throws(() => immobiliare.buildUrl(profilo('atlantide')), UnknownCityError);
  assert.throws(() => idealista.buildUrl(profilo('atlantide')), UnknownCityError);
  // Il messaggio dice cosa fare, non solo cosa è andato storto.
  assert.match(new UnknownCityError('atlantide').message, /elenco/i);
});

test('i percorsi verificati dal vivo restano quelli', () => {
  // Torino e Bari erano le due voci scritte a mano: se la regola generale le riproduce, la regola
  // è tarata su qualcosa di misurato e non su un'ipotesi.
  assert.equal(cityPath('torino', 'subito'), 'annunci-piemonte/affitto/appartamenti/torino/torino/');
  assert.equal(cityPath('bari', 'subito'), 'annunci-puglia/affitto/appartamenti/bari/bari/');
  assert.equal(cityPath('torino', 'immobiliare'), 'affitto-case/torino/');
  assert.equal(cityPath('torino', 'idealista'), 'affitto-case/torino-torino/');
});

test('le province che non si chiamano come il comune finiscono nel posto giusto', () => {
  assert.equal(cityPath('monza', 'idealista'), 'affitto-case/monza-monza-e-della-brianza/');
  assert.equal(findCity('forli')?.province, 'forli-cesena');
  assert.equal(findCity('pesaro')?.province, 'pesaro-e-urbino');
});

test('gli override sono quelli che i portali hanno risposto davvero', () => {
  // Ognuno di questi percorsi è stato incontrato come 404 e poi trovato provando i candidati con
  // `npm run try:cities`. Sono qui perché non si possono dedurre: Subito ignora "e della Brianza",
  // scrive "reggio-nell-emilia" nel comune ma "reggio-emilia" nella provincia, e toglie la "e" a
  // Pesaro e Urbino.
  assert.equal(cityPath('monza', 'subito'), 'annunci-lombardia/affitto/appartamenti/monza/monza/');
  assert.equal(cityPath('laquila', 'subito'), 'annunci-abruzzo/affitto/appartamenti/l-aquila/l-aquila/');
  assert.equal(
    cityPath('reggio-emilia', 'subito'),
    'annunci-emilia-romagna/affitto/appartamenti/reggio-emilia/reggio-nell-emilia/',
  );
  assert.equal(cityPath('pesaro', 'subito'), 'annunci-marche/affitto/appartamenti/pesaro-urbino/pesaro/');
  // L'override vale per il portale che lo richiede e non contamina gli altri.
  assert.equal(cityPath('monza', 'immobiliare'), 'affitto-case/monza/');
});

test("l'elenco è coerente: niente slug doppi, niente campi vuoti", () => {
  const slugs = CITIES.map((c) => c.slug);
  assert.equal(new Set(slugs).size, slugs.length, 'due città con lo stesso slug');
  for (const c of CITIES) {
    assert.match(c.slug, /^[a-z][a-z-]*$/, `slug non normalizzato: ${c.slug}`);
    assert.ok(c.label.trim().length > 0, `etichetta vuota: ${c.slug}`);
    assert.match(c.region, /^[a-z][a-z-]*$/, `regione non normalizzata: ${c.slug}`);
    assert.match(c.province, /^[a-z][a-z-]*$/, `provincia non normalizzata: ${c.slug}`);
  }
});

test("l'elenco copre l'Italia, non due città", () => {
  assert.ok(CITIES.length >= 100, `solo ${CITIES.length} città`);
  assert.equal(new Set(CITIES.map((c) => c.region)).size, 20, 'mancano regioni');
  for (const c of ['milano', 'roma', 'napoli', 'firenze', 'bologna', 'palermo']) {
    assert.ok(isKnownCity(c), `manca ${c}`);
  }
});

test('il prezzo massimo finisce nell\'indirizzo di tutti e tre i portali', () => {
  const p = profilo('milano');
  assert.match(subito.buildUrl(p), /pe=700/);
  assert.match(immobiliare.buildUrl(p), /prezzoMassimo=700/);
  assert.match(idealista.buildUrl(p), /con-prezzo_700/);
});
