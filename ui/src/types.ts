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
  /** Serve a riconoscere che dopo un aggiornamento a rispondere è il server NUOVO. */
  version: string;
  aiConfigured: boolean;
  aiProvider: string;
  imapConfigured: boolean;
  fbSessionExists: boolean;
  browsersInstalled: boolean;
  channels: ChannelMeta[];
}

export interface Stats {
  total: number;
  byStatus: Record<ListingStatus, number>;
  byChannel: Record<string, number>;
  bySource: Record<string, number>;
  scored: number;
  withFields: number;
  withPhotos: number;
  avgScore: number | null;
  worthVisit: number;
  scoreBuckets: { '0-24': number; '25-49': number; '50-74': number; '75-100': number };
  withPrice: number;
  avgPrice: number | null;
  byCity: Record<string, number>;
  firstSeen: string | null;
  lastSeen: string | null;
}

export interface ChainStep {
  provider: string;
  model: string;
  uptime5m: number | null;
  penalty: number;
  state: 'healthy' | 'unknown' | 'penalized';
}

export interface AiHealth {
  configured: boolean;
  provider: string | null;
  model: string | null;
  probe: 'openrouter' | 'none';
  chain: ChainStep[];
  reason?: string;
}

export type KeyState = 'missing' | 'ok' | 'invalid';

export interface ProviderInfo {
  id: string;
  label: string;
  free: boolean;
  signup: string;
  hint: string;
  needsEndpoint: boolean;
  keyOptional: boolean;
  configured: boolean;
  keyState: KeyState;
  baseUrl: string;
  isPrimary: boolean;
  caps: { json: 'native' | 'prefill' | 'prompt'; vision: boolean; health: 'openrouter' | 'none' };
}

export interface ProvidersState {
  primary: string;
  providers: ProviderInfo[];
}

export interface ModelChoice {
  id: string;
  /** Fra i primi della catena: è il gruppo "Consigliati per questo compito". */
  recommended: boolean;
  free: boolean;
  /** `null` dove il provider non pubblica la salute (tutti tranne OpenRouter). */
  uptime5m: number | null;
  penalty: number;
}

export interface TaskModels {
  label: string;
  /** Il modello fissato a mano; `null` = automatico. */
  pinned: string | null;
  /** Chi sceglierebbe da solo. Arriva sempre, anche con un pin attivo. */
  auto: string | null;
  candidates: ModelChoice[];
}

export interface ModelsState {
  configured: boolean;
  provider: string | null;
  publishesHealth?: boolean;
  tasks: { reasoning?: TaskModels; vision?: TaskModels };
}

export interface SearchRow {
  id: string;
  city: string;
  label: string;
  maxPrice: number;
  minRooms?: number;
  maxRooms?: number;
}

export interface CityZones {
  city: string;
  keep: string[];
  avoid: string[];
}

export interface Profile {
  searches: SearchRow[];
  zones: CityZones[];
  musts: string[];
  notes: string;
}

export interface ProfileState {
  profile: Profile;
  /** Il testo generato che legge l'AI: si mostra, non si modifica. */
  generated: string;
  configured: boolean;
}

export interface MailConfig {
  host: string;
  port: number;
  user: string;
  folder: string;
  configured: boolean;
  /** La password arriva dal `.env` e non da qui: spiega perché il campo è vuoto ma funziona. */
  fromEnv: boolean;
  defaults: { host: string; port: number; folder: string };
}

export interface FbSession {
  exists: boolean;
  accountId: string | null;
  expiresAt: string | null;
}

export type JobId = 'fb-login' | 'install-browsers';

export interface JobState {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  lines: string[];
  outcome: 'ok' | 'error' | null;
  message: string | null;
}

export interface UpdateInfo {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  notes: string;
  /** `false` = GitHub non ha risposto. Diverso da "sei aggiornato": va detto. */
  checked: boolean;
  /** `false` fuori dal bundle: dai sorgenti si aggiorna con `git pull`. */
  frozen: boolean;
  detail: string | null;
}

export type UpdateStep = 'idle' | 'download' | 'verify' | 'replace' | 'restart' | 'done' | 'error';

export interface UpdateProgress {
  step: UpdateStep;
  pct: number;
  detail: string | null;
  ts: number | null;
  busy: boolean;
}

export interface SaveKeyResult {
  ok: boolean;
  configured: boolean;
  keyState: KeyState;
  models?: string[];
  recommended?: string | null;
  error?: string;
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
