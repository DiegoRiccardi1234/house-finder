import type { BrowserContext, Page } from 'playwright';
import type { Listing } from '../core/types.js';
import type { FbMarketTarget } from '../config/facebook.js';
import { gotoResilient, autoScroll } from './page-utils.js';
import { parseMarketplaceId, parsePrice, smartTitle, cleanText, looksLikeListing, isShortTerm } from './fb-parse.js';

interface RawCard {
  href: string;
  text: string;
  img: string | null;
}

/** Estrae le card Marketplace: ancore verso /marketplace/item/<id> con testo (prezzo+titolo+luogo). */
async function extractCards(page: Page): Promise<RawCard[]> {
  return page.evaluate(() => {
    const out: { href: string; text: string; img: string | null }[] = [];
    for (const an of Array.from(document.querySelectorAll('a[href*="/marketplace/item/"]')) as HTMLAnchorElement[]) {
      const text = (an as HTMLElement).innerText?.trim() ?? '';
      const img = (an.querySelector('img') as HTMLImageElement | null)?.src ?? null;
      out.push({ href: an.href, text, img });
    }
    return out;
  });
}

/** Apre ogni ricerca Marketplace, scrolla, estrae gli item come Listing normalizzati. */
export async function scrapeMarketplace(
  ctx: BrowserContext,
  targets: FbMarketTarget[],
  maxScroll: number,
): Promise<Listing[]> {
  const out: Listing[] = [];
  for (const t of targets) {
    const page = await ctx.newPage();
    try {
      await gotoResilient(page, t.url);
      // Marketplace virtualizza come il feed: estrai dopo ogni scroll e accumula (dedup per href).
      const raw: RawCard[] = [];
      const rawSeen = new Set<string>();
      const collect = async () => {
        for (const c of await extractCards(page)) {
          if (!rawSeen.has(c.href)) {
            rawSeen.add(c.href);
            raw.push(c);
          }
        }
      };
      await collect();
      for (let i = 0; i < maxScroll; i++) {
        await autoScroll(page);
        await collect();
      }
      const seen = new Set<string>();
      for (const c of raw) {
        const id = parseMarketplaceId(c.href);
        if (!id || seen.has(id)) continue;
        if (!looksLikeListing(c.text)) continue; // scarta i non-affitti (cucine, camerette…)
        seen.add(id);
        out.push({
          source: 'fb-marketplace',
          id,
          url: `https://www.facebook.com/marketplace/item/${id}/`,
          title: smartTitle(c.text, { skipPrice: true }) || 'Annuncio Marketplace',
          price: isShortTerm(c.text) ? null : parsePrice(c.text),
          zone: null,
          desc: cleanText(c.text),
          thumb: c.img,
        });
      }
      console.log(`[fb-market] ${t.name}: ${raw.length} card · ${seen.size} item`);
    } catch (e) {
      console.error(`[fb-market] ${t.name} ERRORE:`, (e as Error).message);
    } finally {
      if (!page.isClosed()) await page.close();
    }
  }
  return out;
}
