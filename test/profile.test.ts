import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveFromLegacy, renderCriteria, type Profile, type SearchRow } from '../src/config/profile.js';

/**
 * La migrazione dal vecchio `criteria.md` scritto a mano.
 *
 * È l'operazione più pericolosa di tutta la riscrittura: sbagliarla non dà errore, dà una ricerca
 * *diversa* — e chi la subisce se ne accorge settimane dopo, da un annuncio che non è arrivato.
 * Il file di prova riproduce il formato reale, sezione per sezione, con la trappola che ci è
 * costata un giro: anche BUDGET ha una riga per città.
 */
const STORICO = `CITTÀ: Torino oppure Bari.

TIPOLOGIA:
- bilocale per me solo (~2 locali), oppure
- casa da condividere con un amico (almeno 3 locali).

BUDGET (affitto mensile — sono i tetti, meglio sotto):
- Torino: bilocale ≤ 700€, casa condivisa ≤ 1100€
- Bari:   bilocale ≤ 550€, casa condivisa ≤ 800€

MUST-HAVE (irrinunciabili):
- ARREDATO (scarta le case non arredate).
- Prezzo entro il tetto (penalizza forte chi sfora).

ZONE — filtro forte ma non assoluto: la qualità della casa pesa.
- Torino — TIENI: Crocetta, San Secondo, Cit Turin (core);
  Parella, Santa Rita nord (ok). SCARTA: Barriera, Aurora, Mirafiori.
- Bari — TIENI: Carrassi, San Pasquale, Murat (core); Umbertino (ok).
  SCARTA: San Paolo, Enziteto, Catino.

NO-GO: non arredato; fuori dalle zone whitelist.

NOTE: full smart working, nessun pendolarismo.
`;

const RICERCHE: SearchRow[] = [
  { id: 'torino-bilocale', city: 'torino', label: 'Torino · bilocale', maxPrice: 700, minRooms: 2, maxRooms: 2 },
  { id: 'bari-bilocale', city: 'bari', label: 'Bari · bilocale', maxPrice: 550, minRooms: 2, maxRooms: 2 },
];

test('le zone restano attaccate alla città giusta', () => {
  const p = deriveFromLegacy(RICERCHE, STORICO);
  const torino = p.zones.find((z) => z.city === 'torino');
  const bari = p.zones.find((z) => z.city === 'bari');

  assert.ok(torino, 'Torino deve avere le sue zone');
  assert.ok(bari, 'Bari deve avere le sue zone');
  assert.ok(torino.keep.includes('Crocetta'));
  assert.ok(bari.keep.includes('Carrassi'));
  // Il difetto vero: i quartieri di Bari finivano tutti sotto Torino, perché la ricerca della
  // riga "- Torino" trovava prima quella della sezione BUDGET.
  assert.ok(!torino.keep.includes('Carrassi'), 'un quartiere di Bari è finito sotto Torino');
  assert.ok(!bari.keep.includes('Crocetta'), 'un quartiere di Torino è finito sotto Bari');
  assert.ok(torino.avoid.includes('Barriera'));
  assert.ok(bari.avoid.includes('Enziteto'));
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
  assert.match(p.notes, /full smart working/);
});

test('il testo rigenerato contiene tutto quello che serve al modello', () => {
  const generato = renderCriteria(deriveFromLegacy(RICERCHE, STORICO));
  assert.match(generato, /CITTÀ: Torino oppure Bari/);
  assert.match(generato, /Torino · bilocale: ≤ 700€/);
  assert.match(generato, /MUST-HAVE/);
  assert.match(generato, /- Torino — TIENI: Crocetta/);
  assert.match(generato, /- Bari — TIENI: Carrassi/);
  assert.match(generato, /full smart working/);
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
