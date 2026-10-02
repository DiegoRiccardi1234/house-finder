import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveFromLegacy, renderCriteria, type Profile, type SearchRow } from '../src/config/profile.js';

/**
 * La migrazione dal vecchio `criteria.md` scritto a mano.
 *
 * È l'operazione più pericolosa di tutta la riscrittura: sbagliarla non dà errore, dà una ricerca
 * *diversa* — e chi la subisce se ne accorge settimane dopo, da un annuncio che non è arrivato.
 * Il file di prova riproduce il formato esempio, sezione per sezione, con la trappola che ci è
 * costata un giro: anche BUDGET ha una riga per città.
 */
const STORICO = `CITTÀ: Milano oppure Bologna.

TIPOLOGIA:
- bilocale indipendente (~2 locali), oppure
- stanza in appartamento condiviso (almeno 3 locali).

BUDGET (affitto mensile — sono i tetti, meglio sotto):
- Milano: bilocale ≤ 700€, casa condivisa ≤ 1100€
- Bologna:   bilocale ≤ 550€, casa condivisa ≤ 800€

MUST-HAVE (irrinunciabili):
- ARREDATO (scarta le case non arredate).
- Prezzo entro il tetto (penalizza forte chi sfora).

ZONE — filtro forte ma non assoluto: la qualità della casa pesa.
- Milano — TIENI: Isola, Porta Romana, Città Studi (core);
  Navigli, Porta Nuova (ok). SCARTA: Zona Periferica, Zona Remota, Zona Lontana.
- Bologna — TIENI: Saragozza, San Donato, Centro (core); Santo Stefano (ok).
  SCARTA: Porta Venezia, Zona Industriale, Zona Esterna.

NO-GO: non arredato; fuori dalle zone whitelist.

NOTE: vicinanza ai mezzi, nessun pendolarismo.
`;

const RICERCHE: SearchRow[] = [
  { id: 'milano-bilocale', city: 'milano', label: 'Milano · bilocale', maxPrice: 700, minRooms: 2, maxRooms: 2 },
  { id: 'bologna-bilocale', city: 'bologna', label: 'Bologna · bilocale', maxPrice: 550, minRooms: 2, maxRooms: 2 },
];

test('le zone restano attaccate alla città giusta', () => {
  const p = deriveFromLegacy(RICERCHE, STORICO);
  const milano = p.zones.find((z) => z.city === 'milano');
  const bologna = p.zones.find((z) => z.city === 'bologna');

  assert.ok(milano, 'Milano deve avere le sue zone');
  assert.ok(bologna, 'Bologna deve avere le sue zone');
  assert.ok(milano.keep.includes('Isola'));
  assert.ok(bologna.keep.includes('Saragozza'));
  // Il difetto vero: i quartieri di Bologna finivano tutti sotto Milano, perché la ricerca della
  // riga "- Milano" trovava prima quella della sezione BUDGET.
  assert.ok(!milano.keep.includes('Saragozza'), 'un quartiere di Bologna è finito sotto Milano');
  assert.ok(!bologna.keep.includes('Isola'), 'un quartiere di Milano è finito sotto Bologna');
  assert.ok(milano.avoid.includes('Zona Periferica'));
  assert.ok(bologna.avoid.includes('Zona Industriale'));
});

test('gli irrinunciabili conservano la spiegazione fra parentesi', () => {
  const p = deriveFromLegacy(RICERCHE, STORICO);
  assert.deepEqual(p.musts, ['ARREDATO (scarta le case non arredate)', 'Prezzo entro il tetto (penalizza forte chi sfora)']);
});

test('le sfumature scritte a mano non si perdono per strada', () => {
  const p = deriveFromLegacy(RICERCHE, STORICO);
  // NO-GO e NOTE sono la parte che nessun campo modella, ed è l'unica che una migrazione
  // può distruggere per sempre.
  assert.match(p.notes, /NO-GO/);
  assert.match(p.notes, /vicinanza ai mezzi/);
  assert.match(p.notes, /TIPOLOGIA/);
  assert.match(p.notes, /stanza in appartamento condiviso/);
  assert.ok(p.zones[0].keep.includes('Città Studi (core)'));
});

test('condizioni di zona e sezioni sconosciute sopravvivono alla conversione', () => {
  const text = STORICO.replace('ZONE — filtro', 'PREFERENZE: niente pianoterra.\n\nZONE — filtro')
    .replace('Città Studi (core);', 'Città Studi (core); Centro SOLO se economico;');
  const first = deriveFromLegacy(RICERCHE, text);
  assert.match(first.notes, /PREFERENZE: niente pianoterra/);
  assert.match(first.notes, /Centro SOLO se economico/);
  const second = deriveFromLegacy(RICERCHE, renderCriteria(first));
  assert.match(second.notes, /Centro SOLO se economico/);
});

test('il testo rigenerato contiene tutto quello che serve al modello', () => {
  const generato = renderCriteria(deriveFromLegacy(RICERCHE, STORICO));
  assert.match(generato, /CITTÀ: Milano oppure Bologna/);
  assert.match(generato, /Milano · bilocale: ≤ 700€/);
  assert.match(generato, /MUST-HAVE/);
  assert.match(generato, /- Milano — TIENI: Isola/);
  assert.match(generato, /- Bologna — TIENI: Saragozza/);
  assert.match(generato, /vicinanza ai mezzi/);
});

test('un giro completo non perde le zone: rigenerare e rileggere dà lo stesso profilo', () => {
  const primo = deriveFromLegacy(RICERCHE, STORICO);
  const secondo = deriveFromLegacy(RICERCHE, renderCriteria(primo));
  assert.deepEqual(
    secondo.zones.map((z) => ({ city: z.city, keep: z.keep.length, avoid: z.avoid.length })),
    primo.zones.map((z) => ({ city: z.city, keep: z.keep.length, avoid: z.avoid.length })),
  );
  assert.deepEqual(secondo.musts, primo.musts);
});

test('profilo vuoto: si genera un testo vuoto, non uno scheletro di sezioni finte', () => {
  const vuoto: Profile = { searches: [], zones: [], musts: [], notes: '' };
  assert.equal(renderCriteria(vuoto).trim(), '');
});

test("senza ricerche l'installazione parte davvero da zero", () => {
  const p = deriveFromLegacy([], STORICO);
  // Nessuna ricerca vuol dire installazione nuova, e il `criteria.md` che si sta leggendo è il
  // file di ESEMPIO. Ricavarne irrinunciabili, zone e note vorrebbe dire aprire la configurazione
  // con caselle già spuntate e un testo mai scritto dall'utente — per giunta la ricerca di
  // qualcun altro. È successo, e la prima impressione era "perché c'è già tutto compilato?".
  assert.deepEqual(p, { searches: [], zones: [], musts: [], notes: '' });
});
