import type { Listing } from './types.js';

/**
 * Chiave univoca per de-duplicare gli annunci tra un run e l'altro.
 * Se l'`id` manca o è degenere ("null"/"undefined"/vuoto) ripiega sull'URL: evita che più
 * annunci senza id collassino su una stessa chiave (`source:null`) sovrascrivendosi.
 */
export function dedupKey(l: Listing): string {
  const raw = l.id == null ? '' : String(l.id).trim();
  const id = raw && raw !== 'null' && raw !== 'undefined' ? raw : (l.url ?? '');
  return `${l.source}:${id}`;
}
