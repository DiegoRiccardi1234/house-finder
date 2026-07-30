import { useState } from 'react';
import { useListings } from '../hooks';
import type { ListingFilters } from '../types';
import { FilterBar } from './FilterBar';
import { ListingCard } from './ListingCard';

const DEFAULT_FILTERS: ListingFilters = {
  channel: '',
  status: '',
  city: '',
  minScore: 0,
  sort: 'score',
  q: '',
  arredato: '',
  soloPrivati: false,
};

export function Dashboard() {
  const [filters, setFilters] = useState<ListingFilters>(DEFAULT_FILTERS);
  const { items, loading, error, refresh, setStatus } = useListings(filters);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <FilterBar filters={filters} onChange={setFilters} count={items.length} />
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="shrink-0 rounded-lg bg-stone-200 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-300 disabled:opacity-50 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
        >
          {loading ? 'Aggiorno…' : '↻ Aggiorna'}
        </button>
      </div>

      {error && <p className="rounded-lg bg-rose-100 p-3 text-sm text-rose-800">Errore: {error}</p>}

      {items.length === 0 && !loading ? (
        <div className="rounded-2xl border border-dashed border-stone-300 p-10 text-center text-stone-500 dark:border-stone-700">
          <p className="text-lg font-medium">Nessun annuncio.</p>
          <p className="mt-1 text-sm">
            Vai su <b>Cerca</b> e lancia una run, oppure allarga i filtri. Il canale email richiede prima le
            ricerche salvate sui portali.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((rec) => (
            <ListingCard key={rec.key} rec={rec} onStatus={setStatus} />
          ))}
        </div>
      )}
    </div>
  );
}
