import type { Listing, Source } from '../core/types.js';
import { gotoResilient, assertNotBlocked } from './page-utils.js';
import { readNextData } from './nextdata.js';

// Percorso di ricerca per città (affitto appartamenti). Confermato dal vivo.
const CITY_PATH: Record<string, string> = {
  torino: 'annunci-piemonte/affitto/appartamenti/torino/torino/',
  bari: 'annunci-puglia/affitto/appartamenti/bari/bari/',
};

// --- mappatura item Subito (__NEXT_DATA__.props.pageProps.initialState.items.originalList) ---

interface SubitoFeatureValue {
  key?: string;
  value?: string;
}
export interface SubitoItem {
  urn?: string;
  subject?: string;
  body?: string; // descrizione libera completa
  urls?: { default?: string };
  features?: Record<string, { values?: SubitoFeatureValue[] }>;
  geo?: { town?: { value?: string }; city?: { value?: string } };
  images?: Array<{ cdnBaseUrl?: string }>;
}

function featureValue(it: SubitoItem, uri: string): SubitoFeatureValue | undefined {
  return it.features?.[uri]?.values?.[0];
}

// Il `cdnBaseUrl` grezzo del __NEXT_DATA__ non è servibile (400): serve il ?rule= che il frontend
// applica alle card. Verificato dal vivo: questo rende un'immagine 200 (anche senza referer).
const SUBITO_IMG_RULE = 'large-fixed-card-1x-auto';
function subitoThumb(it: SubitoItem): string | null {
  const base = it.images?.[0]?.cdnBaseUrl;
  return base ? `${base}?rule=${SUBITO_IMG_RULE}` : null;
}

function toNum(v: string | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Descrizione = testo libero (`body`) + una riga "SCHEDA" coi campi strutturati utili. Esportata per i test. */
export function buildDesc(it: SubitoItem): string | null {
  const label = (uri: string) => featureValue(it, uri)?.value?.trim();
  const feats: string[] = [];
  const arred = label('/furnished');
  if (arred) feats.push(`Arredato: ${arred}`);
  const nosales = label('/nosalesman');
  if (nosales) feats.push(`No agenzie: ${nosales}`);
  const asc = label('/elevator');
  if (asc) feats.push(`Ascensore: ${asc}`);
  const risc = label('/heating');
  if (risc) feats.push(`Riscaldamento: ${risc}`);
  const classe = label('/energy_class');
  if (classe) feats.push(`Classe energetica: ${classe}`);
  const cond = label('/building_condition');
  if (cond) feats.push(`Stato: ${cond}`);
  const aria = label('/air_conditioning');
  if (aria) feats.push(`Aria condizionata: ${aria}`);

  const scheda = feats.length ? `SCHEDA: ${feats.join(' · ')}` : '';
  const desc = [it.body?.trim() || '', scheda].filter(Boolean).join('\n');
  return desc || null;
}

/** Mappa un item Subito grezzo in Listing. Esportata per i test. */
export function mapItem(it: SubitoItem): Listing | null {
  const url = it.urls?.default;
  if (!url) return null;
  const idMatch = url.match(/-(\d+)\.htm/);
  const id = idMatch ? idMatch[1] : it.urn ?? url;

  return {
    source: 'subito',
    id: String(id),
    url,
    title: it.subject ?? 'Annuncio Subito',
    price: toNum(featureValue(it, '/price')?.key),
    rooms: toNum(featureValue(it, '/room')?.key),
    sizeSqm: toNum(featureValue(it, '/size')?.key),
    zone: it.geo?.town?.value ?? it.geo?.city?.value ?? null,
    thumb: subitoThumb(it),
    desc: buildDesc(it),
  };
}

interface SubitoNextData {
  props?: { pageProps?: { initialState?: { items?: { originalList?: SubitoItem[] } } } };
}

export const subito: Source = {
  name: 'subito',

  buildUrl(p) {
    const base = `https://www.subito.it/${CITY_PATH[p.city]}`;
    const q = new URLSearchParams({ order: 'datedesc' }); // più recenti
    if (p.maxPrice) {
      q.set('ps', '0');
      q.set('pe', String(p.maxPrice));
    }
    return `${base}?${q.toString()}`;
  },

  async fetch(p, ctx) {
    const page = await ctx.newPage();
    try {
      await gotoResilient(page, this.buildUrl(p));
      await page.waitForTimeout(1200);
      await assertNotBlocked(page); // blocco anti-bot → errore esplicito, non "0 risultati"
      const data = await readNextData<SubitoNextData>(page);
      if (!data) throw new Error('subito: __NEXT_DATA__ assente (struttura cambiata o blocco silenzioso)');
      const list = data?.props?.pageProps?.initialState?.items?.originalList ?? [];
      return list.map(mapItem).filter((l): l is Listing => l !== null);
    } finally {
      await page.close();
    }
  },
};
