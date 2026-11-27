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
  indirizzo?: string | null;
  conflitto_inquilino?: 'no' | 'si' | 'forse' | null;
  motivo_conflitto?: string | null;
}

export interface GeoPoint {
  lat: number;
  lng: number;
  precision: 'address' | 'street' | 'zone';
  source: 'portal' | 'geocode';
}

export interface AutoDecision {
  rule: 'tipo' | 'locali' | 'stanza' | 'prezzo' | 'area' | 'inquilino';
  reason: string;
  at: string;
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
  city?: string | null;
  geo?: GeoPoint | null;
  /** Scartato da una regola del profilo, non da te. */
  auto?: AutoDecision | null;
  /** Casa buona ma con un vincolo che ti esclude: chiedi se affittano anche a te. */
  askOwner?: { reason: string } | null;
  alsoIn?: string[];
  /** Calcolata dal server: distanza in linea d'aria dal punto di riferimento. */
  distanceKm?: number | null;
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
  /** Ha già detto cosa cerca? Il server lo dichiarava da subito e nessuno lo leggeva. */
  profileConfigured: boolean;
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

export interface CityOption {
  slug: string;
  label: string;
  region: string;
}

export interface SearchRow {
  id: string;
  city: string;
  label: string;
  maxPrice: number;
  minRooms?: number;
  maxRooms?: number;
  tipo?: SearchKind;
}

export type SearchKind = 'monolocale' | 'stanza' | 'bilocale' | 'trilocale' | 'quattro' | 'condivisa' | 'qualsiasi';

/** [lat, lng] */
export type LatLng = [number, number];

export interface Landmark {
  label: string;
  address: string;
  lat: number;
  lng: number;
}

export interface Tenant {
  occupazione: 'lavoratore' | 'studente' | 'altro';
  genere?: 'donna' | 'uomo' | null;
  animali?: boolean | null;
  fumatore?: boolean | null;
}

/** Cosa ha capito l'AI da una frase, prima che l'utente la confermi. */
export interface AssistResult {
  profile: Partial<Profile>;
  /** Quello che nella frase non c'era: si chiede, non si inventa. */
  missing: string[];
  city: string | null;
}

export interface ZoneSuggestion {
  city: string;
  zones: string[];
  source: 'incluso' | 'ai' | 'nessuna';
  detail?: string;
  /** Nessun elenco incluso, ma l'AI può proporli: si chiede col pulsante. */
  aiAvailable?: boolean;
}

export interface CityZones {
  city: string;
  keep: string[];
  avoid: string[];
  area?: { polygon: LatLng[] } | null;
  riferimento?: Landmark | null;
}

export interface Profile {
  searches: SearchRow[];
  zones: CityZones[];
  musts: string[];
  notes: string;
  tenant?: Tenant | null;
  askThreshold?: number;
}

export interface ProfileState {
  profile: Profile;
  /** Il testo generato che legge l'AI: si mostra, non si modifica. */
  generated: string;
  configured: boolean;
  /** Righe incomplete non salvate: prima sparivano in silenzio. */
  skipped?: string[];
  /** false = scansione in corso: le regole nuove le applica lei quando finisce. */
  rulesApplied?: boolean;
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
  /** Brave installato con un profilo: si può prendere la sessione da lì. */
  braveAvailable?: boolean;
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
  lockStale: boolean;
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

/** Quello che il server manda a fine scansione, e che la pagina buttava via. */
export interface RunSummary {
  runId: string;
  channels: string[];
  outcome?: 'succeeded' | 'partial' | 'failed';
  results: Array<{ channel: string; collected: number; unique: number; fresh: number; errors: string[]; persisted?: boolean; outcome?: 'succeeded' | 'partial' | 'failed' }>;
}

/** Il riassunto in tre numeri, quelli che interessano a chi guarda. */
export interface RunEsito {
  nuovi: number;
  visti: number;
  canali: number;
  outcome: 'succeeded' | 'partial' | 'failed';
  errors: string[];
}

export type SseEvent =
  | { type: 'state'; status: RunStatus }
  | { type: 'log'; line: string }
  | { type: 'done'; summary: RunSummary }
  | { type: 'error'; message: string };

export interface RunStatus {
  running: boolean;
  runId: string | null;
  channels: string[];
  startedAt: string | null;
  summary: RunSummary | null;
}

export interface ListingFilters {
  channel: string;
  /** '' tutti · 'active' da vedere (esclusi gli scartati) · 'ask' da chiedere · o uno stato preciso */
  status: string;
  city: string;
  minScore: number;
  sort: 'score' | 'recent' | 'price' | 'distance';
  q: string;
  arredato: string; // '' | 'sì' | 'no'
  soloPrivati: boolean;
  priceMin: string;
  priceMax: string;
  sqmMin: string;
  sqmMax: string;
  /** Locali scelti: 1, 2, 3, 4 (= 4 o più). */
  rooms: number[];
  bagni: string; // '' | '1' | '2'
  piano: string[]; // 'terra' | 'intermedio' | 'ultimo'
  ascensore: boolean;
  aria: boolean;
  autonomo: boolean;
  days: string; // '' | '1' | '3' | '7' | '14'
  maxKm: string;
  inArea: boolean;
  /** Con distanza o area: tieni anche chi non ha una posizione nota. */
  withoutGeo: boolean;
}
