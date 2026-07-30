import { readFileSync } from 'node:fs';
import type { SearchProfile } from '../core/types.js';
import { configReadPath } from './paths.js';

/**
 * Profili di ricerca (città, budget, locali).
 * Sorgente editabile: `data/searches.json`, scavalcabile da `data/local/searches.json`
 * (vedi `paths.ts`). Fallback all'embedded se il file manca.
 */
const FALLBACK: SearchProfile[] = [
  { id: 'torino-bilocale', city: 'torino', label: 'Torino · bilocale', maxPrice: 750, minRooms: 2, maxRooms: 2 },
  { id: 'torino-condivisa', city: 'torino', label: 'Torino · appartamento condiviso', maxPrice: 1200, minRooms: 3 },
  { id: 'bari-bilocale', city: 'bari', label: 'Bari · bilocale', maxPrice: 600, minRooms: 2, maxRooms: 2 },
  { id: 'bari-condivisa', city: 'bari', label: 'Bari · appartamento condiviso', maxPrice: 900, minRooms: 3 },
];

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
