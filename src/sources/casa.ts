// ⚠️ DISABILITATO (non nel registry sources). Casa.it non usa __NEXT_DATA__ e
// l'estrazione DOM generica (extractCards) confonde i campi tra card adiacenti,
// producendo prezzi/m² errati. Per riattivarlo: intercettare la sua API JSON
// (page.on('response', ...) sull'endpoint di ricerca) e mappare quella.
import type { Source } from '../core/types.js';
import { extractCards } from './extract.js';
import { autoScroll, gotoResilient } from './page-utils.js';

// Percorso di ricerca per città (affitto residenziale).
// NB: da confermare al primo run live (`npm run try:source casa torino-bilocale`).
const CITY_PATH: Record<string, string> = {
  torino: 'affitto/residenziale/torino-provincia/',
  bari: 'affitto/residenziale/bari-provincia/',
};

export const casa: Source = {
  name: 'casa',

  buildUrl(p) {
    const base = `https://www.casa.it/${CITY_PATH[p.city]}`;
    const q = new URLSearchParams({ sortType: 'newest' });
    if (p.maxPrice) q.set('priceMax', String(p.maxPrice));
    return `${base}?${q.toString()}`;
  },

  async fetch(p, ctx) {
    const page = await ctx.newPage();
    try {
      await gotoResilient(page, this.buildUrl(p));
      await autoScroll(page);
      return await extractCards(page, {
        source: 'casa',
        linkRe: /casa\.it\/immobili\/(\d+)/,
      });
    } finally {
      await page.close();
    }
  },
};
