import { readFileSync } from 'node:fs';
import { configReadPath } from './paths.js';

/**
 * I criteri casa in linguaggio naturale — cuore del giudizio AI.
 * Sorgente editabile: `data/criteria.md`, scavalcabile da `data/local/criteria.md`
 * (vedi `paths.ts`); modificabile a mano o dalla UI.
 * Se il file manca si usa il FALLBACK qui sotto (comportamento invariato).
 */
const FALLBACK = `
CITTÀ: Torino oppure Bari.

TIPOLOGIA:
- bilocale (~2 locali), oppure
- appartamento da condividere (almeno 3 locali).

BUDGET (affitto mensile — sono i tetti, meglio sotto):
- Torino: bilocale ≤ 750€, condiviso ≤ 1200€
- Bari:   bilocale ≤ 600€, condiviso ≤ 900€

MUST-HAVE (irrinunciabili):
- ARREDATO (scarta le case non arredate).
- Prezzo entro il tetto (penalizza forte chi sfora).

ZONE — filtro forte ma non assoluto: la qualità della casa pesa. Se il quartiere NON è
indicato, NON scartare per zona (valuta il resto e segnala l'incertezza).
- Torino — TIENI: Crocetta, San Secondo, Cit Turin, Cenisia, San Paolo/Borgo San Paolo (core);
  San Salvario verso il bordo, Parella, Santa Rita nord (ok). Centro storico SOLO se sotto la
  metà del tetto o casa chiaramente ottima. SCARTA: Barriera, Aurora, Mirafiori, Lingotto,
  Vanchiglia, Regio Parco, Falchera, Madonna di Campagna e periferie.
- Bari — TIENI: Carrassi, San Pasquale, Madonnella, Murat, Picone (core); Umbertino, Libertà
  verso il centro, Poggiofranco, Quintino Sella (ok). Bari Vecchia solo se affare. SCARTA:
  San Paolo, Enziteto, Catino, San Pio, CEP, San Girolamo-Fesca, Japigia periferica,
  Palese/Santo Spirito e periferie.

NO-GO: non arredato; fuori dalle zone whitelist; centro sopra il tetto senza essere un affare.

NOTE: vicinanza a mezzi/metro pesa positivo; conta la vivibilità e i servizi della zona.
Le fonti Facebook sono post di privati in testo libero (campo "descrizione"), spesso
"no agenzie": leggi lì zona/prezzo/arredato.
`.trim();

/** Legge i criteri freschi dal file dati (per la UI); fallback all'embedded. */
export function loadCriteria(): string {
  try {
    const t = readFileSync(configReadPath('criteria.md'), 'utf8').trim();
    return t || FALLBACK;
  } catch {
    return FALLBACK;
  }
}

/** Snapshot al caricamento del modulo — back-compat per i consumer sincroni. */
export const criteria = loadCriteria();
