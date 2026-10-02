import { readFileSync } from 'node:fs';
import type { City } from '../core/types.js';
import { configReadPath } from './paths.js';

/**
 * Config del motore Facebook (solo PC).
 *
 * I GRUPPI vanno JOINATI a mano con il proprio account PRIMA che lo scraper li veda
 * (i gruppi privati non mostrano i post ai non-membri).
 *
 * Sorgente editabile: `data/facebook.json`, scavalcabile da `data/local/facebook.json`
 * (vedi `paths.ts`); gruppi + Marketplace, modificabile anche dalla UI.
 * Se il file manca, gruppi e Marketplace restano vuoti.
 */
export interface FbGroup {
  name: string;
  url: string;
  city: City;
}

export interface FbMarketTarget {
  name: string;
  url: string;
}

export const FB_STATE_PATH = process.env.FB_STATE_PATH ?? 'state/fb-state.json';
export const FB_MAX_SCROLL = Number(process.env.FB_MAX_SCROLL ?? '6'); // feed virtualizzato: più scroll = più post accumulati

// Placeholder: sostituisci con i gruppi che hai joinato, in `data/facebook.json`
// (o in `data/local/facebook.json`, che ha la precedenza e non è versionato).
interface FbConfig {
  groups: FbGroup[];
  market: FbMarketTarget[];
}

/** Legge gruppi + Marketplace freschi dal file dati (per la UI). */
export function loadFbConfig(): FbConfig {
  try {
    const c = JSON.parse(readFileSync(configReadPath('facebook.json'), 'utf8')) as Partial<FbConfig>;
    return {
      groups: Array.isArray(c.groups) ? c.groups : [],
      market: Array.isArray(c.market) ? c.market : [],
    };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { groups: [], market: [] };
    throw e;
  }
}

const _cfg = loadFbConfig();

/** Snapshot al caricamento del modulo — back-compat per i consumer sincroni. */
export const FB_GROUPS = _cfg.groups;
export const FB_MARKET = _cfg.market;
