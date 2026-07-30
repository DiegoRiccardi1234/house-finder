import type { ListingStatus, StoredListing } from '../core/store.js';

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

const bump = (m: Record<string, number>, k: string) => {
  m[k] = (m[k] ?? 0) + 1;
};

/** Pura: aggregati dell'archivio. Nessuna I/O, così è testabile su uno store noto. */
export function buildStats(rows: StoredListing[]): Stats {
  const byStatus: Record<ListingStatus, number> = { new: 0, favorite: 0, contacted: 0, dismissed: 0 };
  const byChannel: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const byCity: Record<string, number> = {};
  const buckets = { '0-24': 0, '25-49': 0, '50-74': 0, '75-100': 0 };

  let scored = 0;
  let scoreSum = 0;
  let worthVisit = 0;
  let withFields = 0;
  let withPhotos = 0;
  let withPrice = 0;
  let priceSum = 0;
  let firstSeen: string | null = null;
  let lastSeen: string | null = null;

  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    bump(byChannel, r.channel);
    bump(bySource, r.listing.source);
    if (r.fields) {
      withFields++;
      if (r.fields.citta) bump(byCity, r.fields.citta);
    }
    if (r.photos.length > 0) withPhotos++;
    if (r.ai) {
      scored++;
      scoreSum += r.ai.score;
      if (r.ai.worthVisit) worthVisit++;
      const s = r.ai.score;
      if (s >= 75) buckets['75-100']++;
      else if (s >= 50) buckets['50-74']++;
      else if (s >= 25) buckets['25-49']++;
      else buckets['0-24']++;
    }
    const price = r.fields?.prezzo ?? r.listing.price;
    if (price != null) {
      withPrice++;
      priceSum += price;
    }
    if (!firstSeen || r.firstSeen < firstSeen) firstSeen = r.firstSeen;
    if (!lastSeen || r.lastSeen > lastSeen) lastSeen = r.lastSeen;
  }

  return {
    total: rows.length,
    byStatus,
    byChannel,
    bySource,
    scored,
    withFields,
    withPhotos,
    avgScore: scored ? Math.round(scoreSum / scored) : null,
    worthVisit,
    scoreBuckets: buckets,
    withPrice,
    avgPrice: withPrice ? Math.round(priceSum / withPrice) : null,
    byCity,
    firstSeen,
    lastSeen,
  };
}
