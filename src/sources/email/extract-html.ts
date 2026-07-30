import * as cheerio from 'cheerio';
import type { Listing } from '../../core/types.js';

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function num(s: string | undefined): number | null {
  if (!s) return null;
  const n = Number(s.replace(/\./g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Estrae annunci dal corpo HTML di una mail-notifica di portale.
 *
 * Strategia resiliente: trova gli <a> che puntano alla pagina-dettaglio
 * (per pattern URL, gruppo 1 = id), poi risale al blocco-card per leggere
 * prezzo / m² / locali dal testo vicino. Le mail spesso avvolgono i link in
 * redirect di tracciamento: decodifichiamo l'href prima di cercare l'URL vero.
 */
export function extractFromHtml(html: string, source: string, linkRe: RegExp): Listing[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const out: Listing[] = [];

  $('a[href]').each((_, el) => {
    const rawHref = $(el).attr('href') || '';
    const href = safeDecode(rawHref);
    const m = href.match(linkRe);
    if (!m) return;
    const id = m[1];
    if (seen.has(id)) return;
    seen.add(id);

    // URL canonico ricostruito dall'id: le mail avvolgono i link in redirect di
    // tracciamento, quindi non fidarsi dell'href grezzo. m[0] = "portale/path/id".
    const url = `https://www.${m[0].replace(/\/+$/, '')}/`;

    // Risali al contenitore-card (fino a trovare un blocco con "€").
    let node = $(el);
    for (let i = 0; i < 5; i++) {
      const parent = node.parent();
      if (!parent.length) break;
      node = parent;
      if (/€|\beuro\b/i.test(node.text())) break;
    }
    const text = node.text().replace(/\s+/g, ' ').trim();

    const price = num(text.match(/€\s?([\d.]+)/)?.[1]);
    const sizeSqm = num(text.match(/(\d+)\s*m(?:²|q)/i)?.[1]);
    const rooms = num(text.match(/(\d+)\s*local/i)?.[1]);
    const title = $(el).text().replace(/\s+/g, ' ').trim() || text.slice(0, 80);

    out.push({ source, id, url, title, price, rooms, sizeSqm, zone: null, thumb: null });
  });

  return out;
}
