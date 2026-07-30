import type { Page } from 'playwright';
import type { Listing } from '../core/types.js';

export interface CardRule {
  source: string;
  /** Regex sugli href della pagina-dettaglio; il gruppo 1 cattura l'id. */
  linkRe: RegExp;
}

/**
 * Estrazione resiliente basata sui link.
 *
 * Invece di dipendere da classi CSS instabili, trova tutti gli <a> che puntano
 * a una pagina-dettaglio (per pattern URL), poi "risale" al contenitore-card
 * per raccogliere prezzo / m² / locali / immagine dal testo vicino.
 * Meno preciso di un parser dedicato, ma sopravvive ai restyling.
 */
export async function extractCards(page: Page, rule: CardRule): Promise<Listing[]> {
  const reSource = rule.linkRe.source;
  const reFlags = rule.linkRe.flags;

  const raw = await page.evaluate(
    ({ reSource, reFlags, source }) => {
      const re = new RegExp(reSource, reFlags);
      const seen = new Set<string>();
      const out: Array<Record<string, unknown>> = [];

      const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
      for (const a of anchors) {
        const href = a.href;
        const m = href.match(re);
        if (!m) continue;
        const id = m[1];
        if (seen.has(id)) continue;

        // Risale fino a un contenitore che sembri una card (ha immagine + prezzo).
        let card: HTMLElement = a;
        for (let i = 0; i < 6 && card.parentElement; i++) {
          card = card.parentElement;
          if (card.querySelector('img') && /€|\beuro\b/i.test(card.textContent || '')) break;
        }

        const text = (card.textContent || '').replace(/\s+/g, ' ').trim();
        const priceMatch = text.match(/€\s?([\d.]+)/);
        const price = priceMatch ? Number(priceMatch[1].replace(/\./g, '')) : null;
        const roomsMatch = text.match(/(\d+)\s*local/i);
        const rooms = roomsMatch ? Number(roomsMatch[1]) : null;
        const sizeMatch = text.match(/(\d+)\s*m(?:²|q)/i);
        const sizeSqm = sizeMatch ? Number(sizeMatch[1]) : null;

        const img = card.querySelector('img') as HTMLImageElement | null;
        const thumb = img?.getAttribute('src') || img?.getAttribute('data-src') || null;

        const title =
          (a.textContent || '').replace(/\s+/g, ' ').trim() || text.slice(0, 80);

        seen.add(id);
        out.push({
          source,
          id,
          url: href.split('?')[0],
          title,
          price: Number.isFinite(price as number) ? price : null,
          rooms,
          sizeSqm,
          zone: null,
          thumb,
        });
      }
      return out;
    },
    { reSource, reFlags, source: rule.source },
  );

  return raw as unknown as Listing[];
}
