import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStats } from '../src/server/stats.js';
import type { StoredListing } from '../src/core/store.js';

function rec(over: Partial<StoredListing> = {}): StoredListing {
  return {
    key: `k${Math.random()}`,
    listing: { source: 'subito', id: '1', url: 'https://x', title: 't', price: 500 },
    ai: null,
    fields: null,
    visionSummary: null,
    photos: [],
    channel: 'subito',
    firstSeen: '2026-07-20T10:00:00.000Z',
    lastSeen: '2026-07-20T10:00:00.000Z',
    status: 'new',
    notified: false,
    ...over,
  };
}

const ai = (score: number, worthVisit = false) => ({ score, verdict: '', pros: [], cons: [], worthVisit });

test('stats: conteggi, medie e fasce di voto', () => {
  const s = buildStats([
    rec({ ai: ai(90, true), status: 'favorite', channel: 'email' }),
    rec({ ai: ai(60), status: 'contacted' }),
    rec({ ai: ai(30), status: 'dismissed', listing: { source: 'fb-group', id: '2', url: 'u', title: 't', price: 700 } }),
    rec({ ai: ai(10) }),
    rec({ listing: { source: 'subito', id: '5', url: 'u', title: 't', price: null } }),
  ]);

  assert.equal(s.total, 5);
  assert.equal(s.scored, 4);
  assert.deepEqual(s.byStatus, { new: 2, favorite: 1, contacted: 1, dismissed: 1 });
  assert.equal(s.byChannel.email, 1);
  assert.equal(s.bySource['fb-group'], 1);
  assert.equal(s.avgScore, 48); // (90+60+30+10)/4 = 47.5 → 48
  assert.equal(s.worthVisit, 1);
  assert.deepEqual(s.scoreBuckets, { '0-24': 1, '25-49': 1, '50-74': 1, '75-100': 1 });
  // Il prezzo assente non entra nella media, e la base è dichiarata.
  assert.equal(s.withPrice, 4);
  assert.equal(s.avgPrice, 550);
});

test('stats: archivio vuoto non produce NaN', () => {
  const s = buildStats([]);
  assert.equal(s.total, 0);
  assert.equal(s.avgScore, null);
  assert.equal(s.avgPrice, null);
  assert.equal(s.firstSeen, null);
  assert.deepEqual(s.byStatus, { new: 0, favorite: 0, contacted: 0, dismissed: 0 });
});

test('stats: il prezzo estratto dall’AI ha la precedenza su quello del portale', () => {
  const s = buildStats([
    rec({
      listing: { source: 'subito', id: '1', url: 'u', title: 't', price: 999 },
      fields: {
        citta: 'Torino', zona: null, tipologia: null, prezzo: 600, spese: null, m2: null, locali: null,
        bagni: null, piano: null, ascensore: null, arredato: null, classe_energetica: null,
        riscaldamento: null, aria_condizionata: null, disponibile_da: null, tipo_contratto: null,
        vincoli_inquilino: [], contatto: null, riassunto: null,
      },
    }),
  ]);
  assert.equal(s.avgPrice, 600);
  assert.equal(s.byCity.Torino, 1);
});
