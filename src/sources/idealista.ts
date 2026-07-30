import type { BrowserContext } from 'playwright';
import type { Listing, Source } from '../core/types.js';
import { gotoResilient, autoScroll, assertNotBlocked } from './page-utils.js';
import { matches } from '../core/match.js';

// Idealista è server-rendered (NO __NEXT_DATA__): si parsa il DOM.
// Card = article.item; id = data-element-id (numerico, == id nelle mail /immobili/<id>/).
// Percorso per città: <città>-<città> (comune-provincia). Torino verificato dal vivo.
const CITY_PATH: Record<string, string> = {
  torino: 'affitto-case/torino-torino/',
  bari: 'affitto-case/bari-bari/',
};

// La lista dà solo uno snippet troncato: per gli annunci in target apriamo la pagina dettaglio
// per il testo completo. Cap per non moltiplicare i caricamenti (headed, ~3s l'uno).
const DETAIL_CAP = 25;

/** Card grezza estratta dal DOM in-browser (serializzabile). Il mapping vive in `mapRaw` (puro, testabile). */
export interface RawCard {
  id: string | null; // data-element-id
  href: string | null; // /immobile/<id>/
  title: string;
  priceText: string; // "700€/mese"
  details: string[]; // ["2 locali", "45 m²", "4º piano…"] (tempo-mezzi già escluso)
  description: string | null; // snippet troncato dalla lista (p.item-description)
  img: string | null;
}

function parsePrice(s: string): number | null {
  const m = s.match(/([\d.]+)\s*€/);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, ''));
  return Number.isFinite(n) ? n : null;
}

function firstNum(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.match(/\d+/);
  return m ? Number(m[0]) : null;
}

/** Zona = penultimo segmento del titolo quando l'ultimo è la città ("…, Cit Turin, Torino" → "Cit Turin"). */
function zoneFromTitle(title: string): string | null {
  const parts = title
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1].toLowerCase();
  if (last === 'torino' || last === 'bari') return parts[parts.length - 2] ?? null;
  return parts[parts.length - 1];
}

/** Mappa una card grezza in Listing. Puro: unit-test in test/idealista.test.ts. */
export function mapRaw(r: RawCard): Listing | null {
  const id = r.id ?? r.href?.match(/immobile\/(\d+)/)?.[1] ?? null;
  if (!id || !r.href) return null;
  const url = r.href.startsWith('http') ? r.href : `https://www.idealista.it${r.href}`;
  return {
    source: 'idealista',
    id: String(id),
    url,
    title: r.title || 'Annuncio Idealista',
    price: parsePrice(r.priceText),
    rooms: firstNum(r.details.find((d) => /local/i.test(d))),
    sizeSqm: firstNum(r.details.find((d) => /m²|mq/i.test(d))),
    zone: zoneFromTitle(r.title),
    thumb: r.img,
    desc: r.description || null,
  };
}

/** Testo completo dalla pagina dettaglio: descrizione + scheda (piano/classe/ascensore). Best-effort. */
async function fetchDetail(ctx: BrowserContext, url: string): Promise<string | null> {
  const page = await ctx.newPage();
  try {
    await gotoResilient(page, url);
    const detail = await page.evaluate(() => {
      const el =
        document.querySelector('.comment .adCommentsLanguage') ||
        document.querySelector('.comment p') ||
        document.querySelector('.commentsContainer .adCommentsLanguage');
      const desc = el ? (el as HTMLElement).innerText.trim() : '';
      const feats = Array.from(
        document.querySelectorAll('.details-property-feature-one li, .details-property-feature-two li'),
      )
        .map((li) => (li as HTMLElement).innerText.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      return { desc, feats };
    });
    const scheda = detail.feats.length ? `SCHEDA: ${detail.feats.join(' · ')}` : '';
    const out = [detail.desc, scheda].filter(Boolean).join('\n');
    return out || null;
  } finally {
    await page.close();
  }
}

export const idealista: Source = {
  name: 'idealista',

  buildUrl(p) {
    const base = `https://www.idealista.it/${CITY_PATH[p.city]}`;
    const price = p.maxPrice ? `con-prezzo_${p.maxPrice}/` : '';
    return `${base}${price}?ordine=pubblicazione-desc`;
  },

  async fetch(p, ctx) {
    const page = await ctx.newPage();
    let listings: Listing[];
    try {
      await gotoResilient(page, this.buildUrl(p));
      await assertNotBlocked(page); // Idealista blocca via DataDome: errore esplicito, non "0 risultati"
      await autoScroll(page); // le thumbnail sono lazy
      const raw: RawCard[] = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('article.item'));
        return cards.map((el) => {
          const link = el.querySelector('a.item-link');
          const href = link?.getAttribute('href') ?? null;
          const title = (link?.getAttribute('title') || link?.textContent || '').replace(/\s+/g, ' ').trim();
          const priceText = (el.querySelector('.item-price')?.textContent || '').replace(/\s+/g, ' ').trim();
          const details = Array.from(el.querySelectorAll('.item-detail-char .item-detail'))
            .filter((d) => !d.classList.contains('txt-highlight-red')) // scarta il tempo-mezzi
            .map((d) => (d.textContent || '').replace(/\s+/g, ' ').trim());
          const descEl = el.querySelector('.item-description');
          const description = descEl ? (descEl.textContent || '').replace(/\s+/g, ' ').trim() : null;
          const imgEl = el.querySelector('img');
          const img = imgEl?.getAttribute('src') || imgEl?.getAttribute('data-src') || null;
          return { id: el.getAttribute('data-element-id'), href, title, priceText, details, description, img };
        });
      });
      listings = raw.map(mapRaw).filter((l): l is Listing => l !== null);
    } finally {
      await page.close();
    }

    // Ibrido: testo completo dalla pagina dettaglio per gli annunci in target (cap). Non bloccante.
    const targets = listings.filter((l) => matches(l, p)).slice(0, DETAIL_CAP);
    for (const l of targets) {
      const full = await fetchDetail(ctx, l.url).catch(() => null);
      if (full) l.desc = full;
    }
    return listings;
  },
};
