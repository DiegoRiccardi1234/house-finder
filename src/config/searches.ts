import { readFileSync } from 'node:fs';
import type { SearchProfile } from '../core/types.js';
import { configReadPath } from './paths.js';

/**
 * Profili di ricerca (città, budget, locali).
 * Sorgente editabile: `data/searches.json`, scavalcabile da `data/local/searches.json`
 * (vedi `paths.ts`). Fallback all'embedded se il file manca.
 */
const FALLBACK: SearchProfile[] = [];

/** Legge i profili freschi dal file dati (per la UI); fallback all'embedded. */
export function loadSearches(): SearchProfile[] {
  try {
    const arr = JSON.parse(readFileSync(configReadPath('searches.json'), 'utf8')) as SearchProfile[];
    return Array.isArray(arr) && arr.length ? arr : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

/** Snapshot al caricamento del modulo — back-compat per i consumer sincroni. */
export const searches = loadSearches();
