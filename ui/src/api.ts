import type { StoredListing, Meta, ListingStatus, ListingFilters, SearchProfile } from './types';

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

  listings: (f: ListingFilters) => fetch(`/api/listings${buildQuery(f)}`).then((r) => json<StoredListing[]>(r)),

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
