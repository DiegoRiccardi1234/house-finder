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
} from './types';

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
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
  p.set('sort', f.sort);
  const s = p.toString();
  return s ? `?${s}` : '';
}

const jsonHeaders = { 'Content-Type': 'application/json' };

export const api = {
  meta: () => fetch('/api/meta').then((r) => json<Meta>(r)),

  listings: (f: ListingFilters, signal?: AbortSignal) =>
    fetch(`/api/listings${buildQuery(f)}`, { signal }).then((r) => json<StoredListing[]>(r)),

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

  getCriteria: () => fetch('/api/config/criteria').then((r) => json<{ content: string }>(r)),
  putCriteria: (content: string) =>
    fetch('/api/config/criteria', { method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ content }) }),

  getSearches: () => fetch('/api/config/searches').then((r) => json<SearchProfile[]>(r)),
  putSearches: (data: unknown) =>
    fetch('/api/config/searches', { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(data) }),

  getFacebook: () => fetch('/api/config/facebook').then((r) => json<unknown>(r)),
  putFacebook: (data: unknown) =>
    fetch('/api/config/facebook', { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(data) }),
};
