import { readFileSync } from 'node:fs';
import type { SearchProfile } from '../core/types.js';
import { configReadPath } from './paths.js';

/**
 * Profili di ricerca (città, budget, locali).
 * Sorgente editabile: `data/searches.json`, scavalcabile da `data/local/searches.json`
 * (vedi `paths.ts`). Fallback all'embedded se il file manca.
 */
/** Nessuna ricerca salvata significa nessuna scansione, mai una ricerca di esempio. */
export function loadSearches(): SearchProfile[] {
  try {
    const arr = JSON.parse(readFileSync(configReadPath('searches.json'), 'utf8')) as SearchProfile[];
    if (!Array.isArray(arr)) throw new Error('searches.json deve contenere un elenco di ricerche');
    return arr;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

/** Snapshot al caricamento del modulo — back-compat per i consumer sincroni. */
export const searches = loadSearches();
