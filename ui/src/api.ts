import type {
  StoredListing,
  Meta,
  ListingStatus,
  ListingFilters,
  SearchProfile,
  Stats,
  AiHealth,
  ProvidersState,
  SaveKeyResult,
  ModelsState,
  UpdateInfo,
  UpdateProgress,
  MailConfig,
  Profile,
  ProfileState,
  CityOption,
  ZoneSuggestion,
  FbSession,
  JobId,
  JobState,
} from './types';

/** Un browser installato da cui si può (o non si può) prendere la sessione di Facebook. */
export interface FbBrowserInfo {
  id: string;
  label: string;
  available: boolean;
  importable: boolean;
  note?: string;
}

/** Quello che torna `/api/facebook/session` dalla 1.9: la sessione più i browser trovati. */
export type FbSessionDetails = FbSession & {
  browsers?: FbBrowserInfo[];
  /** Il profilo del browser dell'app esiste: Facebook conosce già questo computer. */
  profileReady?: boolean;
};

/**
 * Un URL preso da una pagina esterna (annuncio, gruppo) è sicuro da mettere in un link solo se
 * è http(s): React 18 non blocca `javascript:` negli `href`. Il resto diventa un link morto.
 */
export function safeHref(url: string | null | undefined): string {
  try {
    const u = new URL(url ?? '', window.location.href);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '#';
  } catch {
    return '#';
  }
}

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const body = await r.json().catch(() => ({})) as { detail?: string; error?: string };
    if (r.status === 409) throw new Error(body.detail ?? 'Archivio occupato: attendi la fine della scansione o dell’operazione in corso e riprova.');
    throw new Error(body.detail ?? body.error ?? `HTTP ${r.status}`);
  }
  return r.json() as Promise<T>;
}

function buildQuery(f: ListingFilters): string {
  const p = new URLSearchParams();
  if (f.channel) p.set('channel', f.channel);
  if (f.status) p.set('status', f.status);
  if (f.city) p.set('city', f.city);
  if (f.minScore > 0) p.set('minScore', String(f.minScore));
  if (f.q) p.set('q', f.q);
  if (f.arredato) p.set('arredato', f.arredato);
  if (f.soloPrivati) p.set('soloPrivati', '1');
  const num = (k: string, v: string) => { if (v.trim() && Number.isFinite(Number(v))) p.set(k, v.trim()); };
  num('priceMin', f.priceMin);
  num('priceMax', f.priceMax);
  num('sqmMin', f.sqmMin);
  num('sqmMax', f.sqmMax);
  if (f.rooms.length) p.set('rooms', f.rooms.join(','));
  if (f.bagni) p.set('bagni', f.bagni);
  if (f.piano.length) p.set('piano', f.piano.join(','));
  if (f.ascensore) p.set('ascensore', '1');
  if (f.aria) p.set('aria', '1');
  if (f.autonomo) p.set('autonomo', '1');
  if (f.days) p.set('days', f.days);
  num('maxKm', f.maxKm);
  if (f.inArea) p.set('inArea', '1');
  if ((f.maxKm || f.inArea) && !f.withoutGeo) p.set('withoutGeo', '0');
  p.set('sort', f.sort);
  const s = p.toString();
  return s ? `?${s}` : '';
}

const jsonHeaders = { 'Content-Type': 'application/json' };

export const api = {
  meta: () => fetch('/api/meta').then((r) => json<Meta>(r)),

  listings: (f: ListingFilters, signal?: AbortSignal) =>
    fetch(`/api/listings${buildQuery(f)}`, { signal }).then((r) => json<StoredListing[]>(r)),

  /** Come `listings`, più quanti annunci ha tolto il profilo (per dirlo invece di nasconderlo). */
  listingsWithHidden: async (f: ListingFilters, signal?: AbortSignal) => {
    const r = await fetch(`/api/listings${buildQuery(f)}`, { signal });
    const items = await json<StoredListing[]>(r);
    return { items, autoDismissed: Number(r.headers.get('X-Auto-Dismissed') ?? 0), total: Number(r.headers.get('X-Total-Listings') ?? items.length) };
  },

  /** Riapplica le regole del profilo all'archivio (non usa l'AI). */
  reapplyRules: () =>
    fetch('/api/listings/rules', { method: 'POST', headers: jsonHeaders, body: '{}' }).then((r) =>
      json<{ ok: boolean; dismissed?: number; restored?: number; ask?: number }>(r)),

  /** Cerca un luogo (via, piazza, ufficio) per il punto di riferimento. */
  geoSearch: (q: string) =>
    fetch(`/api/geo/search?q=${encodeURIComponent(q)}`).then((r) => json<Array<{ lat: number; lng: number; label: string }>>(r)),

  stats: () => fetch('/api/stats').then((r) => json<Stats>(r)),

  aiHealth: () => fetch('/api/ai/health').then((r) => json<AiHealth>(r)),

  aiProviders: () => fetch('/api/ai/providers').then((r) => json<ProvidersState>(r)),

  saveProviderKey: (id: string, body: { key?: string; baseUrl?: string }) =>
    fetch(`/api/ai/providers/${encodeURIComponent(id)}/key`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify(body),
    }).then((r) => json<SaveKeyResult>(r)),

  aiModels: () => fetch('/api/ai/models').then((r) => json<ModelsState>(r)),

  checkUpdate: (force = false) =>
    fetch(`/api/update/check${force ? '?force=1' : ''}`).then((r) => json<UpdateInfo>(r)),

  updateProgress: () => fetch('/api/update/progress').then((r) => json<UpdateProgress>(r)),

  /** Risponde `202` e continua per conto suo: da lì in poi si segue `updateProgress`. */
  startUpdate: () => fetch('/api/update/install', { method: 'POST', headers: jsonHeaders, body: '{}' }),

  clearUpdateLock: () => fetch('/api/update/lock', { method: 'DELETE' }).then((r) => json<{ ok: boolean }>(r)),

  setPrimaryProvider: (body: { provider: string; model?: string; visionModel?: string }) =>
    fetch('/api/ai/primary', { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(body) }).then((r) =>
      json<{ ok: boolean }>(r),
    ),

  setStatus: (key: string, status: ListingStatus) =>
    fetch(`/api/listings/${encodeURIComponent(key)}/status`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ status }),
    }).then((r) => json<StoredListing>(r)),

  startRun: (channels: string[]) =>
    fetch('/api/runs', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ channels }) }),

  // Content-Type application/json obbligatorio lato server (anti-CSRF): mandalo sempre.
  resetListings: () =>
    fetch('/api/listings/reset', { method: 'POST', headers: jsonHeaders, body: '{}' }).then((r) =>
      json<{ ok: boolean; cleared: number }>(r),
    ),

  refilterListings: () =>
    fetch('/api/listings/refilter', { method: 'POST', headers: jsonHeaders, body: '{}' }).then((r) =>
      json<{ ok: boolean; removed: number; after: number }>(r),
    ),

  // --- Cose che prima si facevano solo da terminale ---
  job: (id: JobId) => fetch(`/api/jobs/${id}`).then((r) => json<JobState>(r)),

  fbSession: () => fetch('/api/facebook/session').then((r) => json<FbSessionDetails>(r)),
  fbLogin: () => fetch('/api/facebook/login', { method: 'POST', headers: jsonHeaders, body: '{}' }),
  fbImportBrave: () =>
    fetch('/api/facebook/import-brave', { method: 'POST', headers: jsonHeaders, body: '{}' }),
  /** Prende la sessione da un browser installato (Brave, Edge, Vivaldi, Opera, Firefox). */
  fbImport: (browser: string) =>
    fetch('/api/facebook/import', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ browser }) }),
  /** `all`: cancella anche il profilo del browser dell'app (il computer torna "sconosciuto" a Facebook). */
  fbForget: (all = false) =>
    fetch('/api/facebook/session', {
      method: 'DELETE',
      ...(all ? { headers: jsonHeaders, body: JSON.stringify({ all: true }) } : {}),
    }).then((r) => json<{ ok: boolean; profileRemoved?: boolean }>(r)),

  installBrowsers: () =>
    fetch('/api/system/install-browsers', { method: 'POST', headers: jsonHeaders, body: '{}' }),

  getMail: () => fetch('/api/config/mail').then((r) => json<MailConfig>(r)),
  putMail: (body: { host?: string; port?: number; user?: string; pass?: string; folder?: string }) =>
    fetch('/api/config/mail', { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(body) }).then(
      (r) => json<MailConfig>(r),
    ),
  testMail: () =>
    fetch('/api/config/mail/test', { method: 'POST', headers: jsonHeaders, body: '{}' }).then(
      async (r) => (await r.json()) as { ok: boolean; folder?: string; messages?: number; error?: string },
    ),
  forgetMail: () => fetch('/api/config/mail', { method: 'DELETE' }).then((r) => json<MailConfig>(r)),

  cities: () => fetch('/api/cities').then((r) => json<CityOption[]>(r)),

  /** Una frase → un profilo. Gli errori li legge il chiamante: hanno rimedi diversi. */
  assistSearch: (text: string) =>
    fetch('/api/assist/search', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ text }) }),

  zoneSuggestions: (city: string, ai = false) =>
    fetch(`/api/assist/zones/${encodeURIComponent(city)}${ai ? '?ai=1' : ''}`).then((r) => json<ZoneSuggestion>(r)),

  getProfile: () => fetch('/api/config/profile').then((r) => json<ProfileState>(r)),
  putProfile: (p: Profile) =>
    fetch('/api/config/profile', { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(p) }).then(
      (r) => json<ProfileState>(r),
    ),

  getCriteria: () => fetch('/api/config/criteria').then((r) => json<{ content: string }>(r)),
  putCriteria: (content: string) =>
    fetch('/api/config/criteria', { method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ content }) }),

  getSearches: () => fetch('/api/config/searches').then((r) => json<SearchProfile[]>(r)),
  putSearches: (data: unknown) =>
    fetch('/api/config/searches', { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(data) }),

  getFacebook: () => fetch('/api/config/facebook').then((r) => json<unknown>(r)),
  // Passa da `json()`: un 409 (scansione in corso) o un 400 devono diventare un errore visibile,
  // non un «Salvato.» con i gruppi mai scritti.
  putFacebook: (data: unknown) =>
    fetch('/api/config/facebook', { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(data) }).then((r) => json<unknown>(r)),
};
