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

test('gli irrinunciabili arrivano senza la spiegazione fra parentesi', () => {
  const p = deriveFromLegacy(RICERCHE, STORICO);
  assert.deepEqual(p.musts, ['ARREDATO', 'Prezzo entro il tetto']);
});

test('le sfumature scritte a mano non si perdono per strada', () => {
  const p = deriveFromLegacy(RICERCHE, STORICO);
  // NO-GO e NOTE sono la parte che nessun campo modella, ed è l'unica che una migrazione
  // può distruggere per sempre.
  assert.match(p.notes, /NO-GO/);
  assert.match(p.notes, /vicinanza ai mezzi/);
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

test('senza ricerche non si inventano città', () => {
  const p = deriveFromLegacy([], STORICO);
  assert.equal(p.searches.length, 0);
  // Le zone si tengono comunque: riscriverle a mano è la cosa più laboriosa del profilo.
  assert.ok(p.zones.length > 0 || p.notes.length > 0);
});
