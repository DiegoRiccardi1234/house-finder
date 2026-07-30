import type { Listing, Source } from '../core/types.js';
import { gotoResilient, assertNotBlocked } from './page-utils.js';
import { readNextData } from './nextdata.js';

// Percorso di ricerca per città (affitto case). Confermato dal vivo.
const CITY_PATH: Record<string, string> = {
  torino: 'affitto-case/torino/',
  bari: 'affitto-case/bari/',
};

interface ImmProperty {
  rooms?: string | number;
  surface?: string;
  caption?: string;
  description?: string;
  featureList?: Array<{ type?: string; label?: string }>;
  multimedia?: { photos?: Array<{ urls?: Record<string, string> }> };
  location?: { microzone?: string; locality?: string };
}
export interface ImmResult {
  seo?: { url?: string };
  realEstate?: {
    id?: number | string;
    title?: string;
    price?: { value?: number };
    properties?: ImmProperty[];
  };
}
interface ImmNextData {
  props?: {
    pageProps?: {
      dehydratedState?: { queries?: Array<{ state?: { data?: { results?: ImmResult[] } } }> };
    };
  };
}

function firstDigits(v: string | number | undefined): number | null {
  if (v == null) return null;
  const m = String(v).match(/\d+/);
  return m ? Number(m[0]) : null;
}

/** Descrizione = caption + testo libero (quando c'è) + label strutturate (Arredato, ecc.). Esportata per i test. */
export function buildDesc(prop: ImmProperty | undefined): string | null {
  if (!prop) return null;
  const parts: string[] = [];
  if (prop.caption?.trim()) parts.push(prop.caption.trim());
  if (prop.description?.trim()) parts.push(prop.description.trim());
  const feats = (prop.featureList ?? []).map((f) => f.label?.trim()).filter((s): s is string => !!s);
  if (feats.length) parts.push(`SCHEDA: ${feats.join(' · ')}`);
  const desc = parts.join('\n');
  return desc || null;
}

/** Mappa un risultato Immobiliare grezzo in Listing. Esportata per i test. */
export function mapResult(r: ImmResult): Listing | null {
  const re = r.realEstate;
  const url = r.seo?.url;
  if (!re || !url || re.id == null) return null;
  const prop = re.properties?.[0];
  const photo = prop?.multimedia?.photos?.[0]?.urls;
  const thumb = photo ? photo.large ?? photo.medium ?? photo.small ?? Object.values(photo)[0] : null;

  return {
    source: 'immobiliare',
    id: String(re.id),
    url,
    title: re.title ?? 'Annuncio Immobiliare',
    price: re.price?.value ?? null,
    rooms: firstDigits(prop?.rooms),
    sizeSqm: firstDigits(prop?.surface),
    zone: prop?.location?.microzone ?? prop?.location?.locality ?? null,
    thumb: thumb ?? null,
    desc: buildDesc(prop),
  };
}

export const immobiliare: Source = {
  name: 'immobiliare',

  buildUrl(p) {
    const base = `https://www.immobiliare.it/${CITY_PATH[p.city]}`;
    const q = new URLSearchParams({ criterio: 'dataModifica', ordine: 'desc' });
    if (p.maxPrice) q.set('prezzoMassimo', String(p.maxPrice));
    return `${base}?${q.toString()}`;
  },

  async fetch(p, ctx) {
    const page = await ctx.newPage();
    try {
      await gotoResilient(page, this.buildUrl(p));
      await page.waitForTimeout(1200);
      await assertNotBlocked(page); // blocco anti-bot → errore esplicito, non "0 risultati"
      const data = await readNextData<ImmNextData>(page);
      if (!data) throw new Error('immobiliare: __NEXT_DATA__ assente (struttura cambiata o blocco silenzioso)');
      const results = data?.props?.pageProps?.dehydratedState?.queries?.[0]?.state?.data?.results ?? [];
      return results.map(mapResult).filter((l): l is Listing => l !== null);
    } finally {
      await page.close();
    }
  },
};
