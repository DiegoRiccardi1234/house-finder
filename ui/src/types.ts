// DTO scritti a mano che rispecchiano i tipi backend (src/core/store.ts, types.ts).
// Tenuti minimi: se il backend cambia forma, aggiornare qui.

export type ChannelId = 'email' | 'subito' | 'immobiliare' | 'idealista' | 'facebook';
export type ListingStatus = 'new' | 'favorite' | 'dismissed' | 'contacted';

export interface Listing {
  source: string;
  id: string;
  url: string;
  title: string;
  price: number | null;
  rooms?: number | null;
  sizeSqm?: number | null;
  zone?: string | null;
  thumb?: string | null;
  desc?: string | null;
}

export interface AiScore {
  score: number;
  verdict: string;
  pros: string[];
  cons: string[];
  worthVisit: boolean;
}

export type Furnished = 'sì' | 'parziale' | 'no';
export type ContactType = 'privato' | 'agenzia';

export interface ListingFields {
  citta: string | null;
  zona: string | null;
  tipologia: string | null;
  prezzo: number | null;
  spese: string | null;
  m2: number | null;
  locali: number | null;
  bagni: number | null;
  piano: string | null;
  ascensore: boolean | null;
  arredato: Furnished | null;
  classe_energetica: string | null;
  riscaldamento: string | null;
  aria_condizionata: boolean | null;
  disponibile_da: string | null;
  tipo_contratto: string | null;
  vincoli_inquilino: string[];
  contatto: ContactType | null;
  riassunto: string | null;
}

export interface StoredListing {
  key: string;
  listing: Listing;
  ai: AiScore | null;
  fields: ListingFields | null;
  visionSummary: string | null;
  photos: string[];
  channel: string;
  firstSeen: string;
  lastSeen: string;
  status: ListingStatus;
  notified: boolean;
}

export interface ChannelMeta {
  id: ChannelId;
  label: string;
  available: boolean;
  reason: string;
}

export interface Meta {
  aiConfigured: boolean;
  imapConfigured: boolean;
  fbSessionExists: boolean;
  channels: ChannelMeta[];
}

export interface SearchProfile {
  id: string;
  city: 'torino' | 'bari';
  label: string;
  maxPrice: number;
  minRooms?: number;
  maxRooms?: number;
}

export type SseEvent =
  | { type: 'log'; line: string }
  | { type: 'done'; summary: unknown }
  | { type: 'error'; message: string };

export interface ListingFilters {
  channel: string;
  status: string;
  city: string;
  minScore: number;
  sort: 'score' | 'recent' | 'price';
  q: string;
  arredato: string; // '' | 'sì' | 'no'
  soloPrivati: boolean;
}
