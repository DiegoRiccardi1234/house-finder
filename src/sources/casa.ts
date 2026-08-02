// ⚠️ DISABILITATO (non nel registry sources). Casa.it non usa __NEXT_DATA__ e
// l'estrazione DOM generica (extractCards) confonde i campi tra card adiacenti,
// producendo prezzi/m² errati. Per riattivarlo: intercettare la sua API JSON
// (page.on('response', ...) sull'endpoint di ricerca) e mappare quella.
import type { Source } from '../core/types.js';
import { extractCards } from './extract.js';
import { autoScroll, gotoResilient } from './page-utils.js';
import { requireCity } from '../config/cities.js';

// Percorso composto dal registro città come per gli altri portali: era rimasta l'ultima mappa
// scritta a mano da due voci, e riattivare questa sorgente con quella dentro avrebbe rimesso in
// piedi lo stesso guasto silenzioso (`casa.it/undefined`) che il registro serve a togliere.
// NB: il formato del percorso è da confermare dal vivo (`npm run try:source casa <profilo>`).
export const casa: Source = {
  name: 'casa',

  buildUrl(p) {
    const c = requireCity(p.city);
    const base = `https://www.casa.it/affitto/residenziale/${c.slug}-provincia/`;
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
