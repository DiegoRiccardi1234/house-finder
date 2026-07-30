import type { BrowserContext, Page } from 'playwright';
import type { Listing } from '../core/types.js';
import type { FbGroup } from '../config/facebook.js';
import { gotoResilient, autoScroll } from './page-utils.js';
import { parsePostId, parsePrice, smartTitle, cleanText, stripFbChrome, looksLikeListing, isShortTerm } from './fb-parse.js';

interface RawPost {
  href: string | null;
  text: string;
  img: string | null;
}

/**
 * Estrae i post visibili dal feed del gruppo. Selettori volutamente larghi (FB offusca le
 * classi): prende gli <article> del feed, l'innerText e il primo permalink /posts|permalink/.
 * NB: v1 da tarare dal vivo (DOM FB cambia spesso).
 */
async function extractPosts(page: Page): Promise<RawPost[]> {
  return page.evaluate(() => {
    const out: { href: string | null; text: string; img: string | null }[] = [];
    const articles = Array.from(document.querySelectorAll('div[role="feed"] div[role="article"]'));
    for (const a of articles) {
      const text = (a as HTMLElement).innerText?.trim() ?? '';
      if (!text) continue;
      let href: string | null = null;
      for (const an of Array.from(a.querySelectorAll('a[href]')) as HTMLAnchorElement[]) {
        const h = an.getAttribute('href') || '';
        if (/\/(posts|permalink)\/\d+/.test(h) || /multi_permalinks=\d+/.test(h) || /story_fbid=\d+/.test(h)) {
          href = an.href;
          break;
        }
      }
      const img = (a.querySelector('img[src*="scontent"]') as HTMLImageElement | null)?.src ?? null;
      out.push({ href, text, img });
    }
    return out;
  });
}

/** Apre ogni gruppo (ordine cronologico), scrolla, estrae i post come Listing normalizzati. */
export async function scrapeGroups(
  ctx: BrowserContext,
  groups: FbGroup[],
  maxScroll: number,
): Promise<Listing[]> {
  const out: Listing[] = [];
  for (const g of groups) {
    const page = await ctx.newPage();
    try {
      const url = g.url.replace(/\/?$/, '/') + '?sorting_setting=CHRONOLOGICAL';
      await gotoResilient(page, url);
      // FB VIRTUALIZZA il feed: gli article fuori schermo vengono rimossi dal DOM. Estraendo una
      // sola volta a fine scroll se ne vedono ~4. Quindi estrai DOPO OGNI scroll e accumula.
      const raw: RawPost[] = [];
      const rawSeen = new Set<string>();
      const collect = async () => {
        for (const p of await extractPosts(page)) {
          const k = p.href ?? p.text.slice(0, 100);
          if (!rawSeen.has(k)) {
            rawSeen.add(k);
            raw.push(p);
          }
        }
      };
      await collect();
      for (let i = 0; i < maxScroll; i++) {
        await autoScroll(page);
        await collect();
      }
      const seen = new Set<string>();
      for (const p of raw) {
        const id = parsePostId(p.href);
        if (!id || seen.has(id)) continue;
        const clean = stripFbChrome(p.text);
        if (!looksLikeListing(clean)) continue; // scarta commenti/chrome/non-offerte, tiene le offerte (anche nei commenti)
        seen.add(id);
        out.push({
          source: 'fb-group',
          id,
          url: p.href!,
          title: smartTitle(clean, { skipAuthor: true }) || `Post — ${g.name}`,
          price: isShortTerm(clean) ? null : parsePrice(clean),
          zone: null,
          desc: `[${g.name} · ${g.city}] ${cleanText(clean)}`,
          thumb: p.img,
        });
      }
      console.log(`[fb-group] ${g.name}: ${raw.length} article · ${seen.size} post con id`);
    } catch (e) {
      console.error(`[fb-group] ${g.name} ERRORE:`, (e as Error).message);
    } finally {
      if (!page.isClosed()) await page.close();
    }
  }
  return out;
}
