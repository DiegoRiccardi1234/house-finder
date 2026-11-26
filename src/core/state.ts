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

/**
 * Firma del testo di un post, per riconoscere lo stesso annuncio pubblicato in più gruppi.
 *
 * Gruppi diversi danno id di post diversi, quindi `dedupKey` li tiene separati: nell'archivio di
 * novembre lo stesso monolocale compariva sei volte. Si confronta il testo, togliendo il prefisso
 * `[gruppo · città]` (che cambia da gruppo a gruppo) e tutto quello che non è lettera o cifra.
 * Sotto gli 80 caratteri non si firma niente: "Affitto bilocale, scrivimi" è troppo generico per
 * dire che due post sono lo stesso.
 */
export function textSignature(l: { desc?: string | null; title?: string }): string | null {
  const raw = (l.desc ?? l.title ?? '').replace(/^\[[^\]]*\]\s*/, '');
  const norm = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (norm.length < 80) return null;
  return norm.slice(0, 400);
}

/** La città dichiarata dal prefisso `[gruppo · città]` che i post dei gruppi FB portano nel testo. */
export function groupCityOf(l: Pick<Listing, 'desc'>): string | null {
  const m = (l.desc ?? '').match(/^\[[^\]]*·\s*([^\]]+)\]/);
  return m?.[1]?.trim().toLowerCase() || null;
}
