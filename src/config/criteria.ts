import { readFileSync } from 'node:fs';
import { configReadPath } from './paths.js';

/**
 * I criteri casa in linguaggio naturale — cuore del giudizio AI.
 * Sorgente editabile: `data/criteria.md`, scavalcabile da `data/local/criteria.md`
 * (vedi `paths.ts`); modificabile a mano o dalla UI.
 * Se il file manca, i criteri restano vuoti fino alla configurazione.
 */
/** Non sostituisce criteri mancanti/vuoti con preferenze di un'altra persona. */
export function loadCriteria(): string {
  try {
    const t = readFileSync(configReadPath('criteria.md'), 'utf8').trim();
    return t;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw e;
  }
}

/** Snapshot al caricamento del modulo — back-compat per i consumer sincroni. */
export const criteria = loadCriteria();
