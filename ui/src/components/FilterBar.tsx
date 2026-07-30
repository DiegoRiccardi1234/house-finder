import type { ListingFilters } from '../types';

const sel =
  'rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm dark:border-stone-700 dark:bg-stone-900';

export function FilterBar({
  filters,
  onChange,
  count,
}: {
  filters: ListingFilters;
  onChange: (f: ListingFilters) => void;
  count: number;
}) {
  const set = <K extends keyof ListingFilters>(k: K, v: ListingFilters[K]) => onChange({ ...filters, [k]: v });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        placeholder="Cerca titolo/zona…"
        value={filters.q}
        onChange={(e) => set('q', e.target.value)}
        className={`${sel} min-w-48 flex-1`}
      />
      <select value={filters.city} onChange={(e) => set('city', e.target.value)} className={sel}>
        <option value="">Tutte le città</option>
        <option value="torino">Torino</option>
        <option value="bari">Bari</option>
      </select>
      <select value={filters.channel} onChange={(e) => set('channel', e.target.value)} className={sel}>
        <option value="">Tutti i canali</option>
        <option value="email">Email</option>
        <option value="immobiliare">Immobiliare</option>
        <option value="subito">Subito</option>
        <option value="idealista">Idealista</option>
        <option value="facebook">Facebook</option>
      </select>
      <select value={filters.status} onChange={(e) => set('status', e.target.value)} className={sel}>
        <option value="">Tutti gli stati</option>
        <option value="new">Nuovi</option>
        <option value="favorite">Preferiti</option>
        <option value="contacted">Contattati</option>
        <option value="dismissed">Scartati</option>
      </select>
      <select value={filters.arredato} onChange={(e) => set('arredato', e.target.value)} className={sel}>
        <option value="">Arredato: tutti</option>
        <option value="sì">Arredato</option>
        <option value="no">Non arredato</option>
      </select>
      <select value={filters.sort} onChange={(e) => set('sort', e.target.value as ListingFilters['sort'])} className={sel}>
        <option value="score">Voto AI ↓</option>
        <option value="recent">Più recenti</option>
        <option value="price">Prezzo ↑</option>
      </select>
      <label className="flex items-center gap-1.5 text-sm text-stone-600 dark:text-stone-400">
        <input type="checkbox" checked={filters.soloPrivati} onChange={(e) => set('soloPrivati', e.target.checked)} />
        solo privati
      </label>
      <label className="flex items-center gap-1.5 text-sm text-stone-600 dark:text-stone-400">
        min voto
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={filters.minScore}
          onChange={(e) => set('minScore', Number(e.target.value))}
        />
        <span className="w-6 tabular-nums">{filters.minScore}</span>
      </label>
      <span className="ml-auto text-sm text-stone-500 dark:text-stone-400">{count} annunci</span>
    </div>
  );
}
