import { readFileSync } from 'node:fs';
import { configReadPath } from './paths.js';

/**
 * I criteri casa in linguaggio naturale — cuore del giudizio AI.
 * Sorgente editabile: `data/criteria.md`, scavalcabile da `data/local/criteria.md`
 * (vedi `paths.ts`); modificabile a mano o dalla UI.
 * Se il file manca si usa il FALLBACK qui sotto (comportamento invariato).
 */
const FALLBACK = '';

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
