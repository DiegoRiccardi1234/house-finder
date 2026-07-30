import type { ListingFilters, SearchProfile, ChannelMeta } from '../types';
import { Field, Input, Select } from '../ui/Field';
import { Kicker } from '../ui/Kicker';

const CITY_LABEL: Record<string, string> = { torino: 'Torino', bari: 'Bari' };

export function FilterBar({
  filters,
  onChange,
  count,
  searches,
  channels,
}: {
  filters: ListingFilters;
  onChange: (f: ListingFilters) => void;
  count: number;
  /** Le città vengono dai profili di ricerca configurati, non da una lista fissa. */
  searches: SearchProfile[];
  channels: ChannelMeta[];
}) {
  const set = <K extends keyof ListingFilters>(k: K, v: ListingFilters[K]) =>
    onChange({ ...filters, [k]: v });

  const cities = Array.from(new Set(searches.map((s) => s.city)));

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-7">
      <Field label="Cerca" className="col-span-2">
        {(p) => (
          <Input
            {...p}
            type="search"
            placeholder="titolo o zona…"
            value={filters.q}
            onChange={(e) => set('q', e.target.value)}
          />
        )}
      </Field>

      <Field label="Città">
        {(p) => (
          <Select {...p} value={filters.city} onChange={(e) => set('city', e.target.value)}>
            <option value="">Tutte</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {CITY_LABEL[c] ?? c}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field label="Canale">
        {(p) => (
          <Select {...p} value={filters.channel} onChange={(e) => set('channel', e.target.value)}>
            <option value="">Tutti</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field label="Stato">
        {(p) => (
          <Select {...p} value={filters.status} onChange={(e) => set('status', e.target.value)}>
            <option value="">Tutti</option>
            <option value="new">Nuovi</option>
            <option value="favorite">Preferiti</option>
            <option value="contacted">Contattati</option>
            <option value="dismissed">Scartati</option>
          </Select>
        )}
      </Field>

      <Field label="Arredato">
        {(p) => (
          <Select {...p} value={filters.arredato} onChange={(e) => set('arredato', e.target.value)}>
            <option value="">Tutti</option>
            <option value="sì">Arredato</option>
            <option value="no">Non arredato</option>
          </Select>
        )}
      </Field>

      <Field label="Ordina per">
        {(p) => (
          <Select
            {...p}
            value={filters.sort}
            onChange={(e) => set('sort', e.target.value as ListingFilters['sort'])}
          >
            <option value="score">Voto AI ↓</option>
            <option value="recent">Più recenti</option>
            <option value="price">Prezzo ↑</option>
          </Select>
        )}
      </Field>

      <Field label={`Voto minimo: ${filters.minScore}`}>
        {(p) => (
          <input
            {...p}
            type="range"
            min={0}
            max={100}
            step={5}
            value={filters.minScore}
            onChange={(e) => set('minScore', Number(e.target.value))}
            className="w-full accent-[var(--accent)]"
          />
        )}
      </Field>

      <div className="col-span-2 flex items-end gap-4 sm:col-span-1">
        <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap pb-1.5 text-sm text-muted">
          <input
            type="checkbox"
            checked={filters.soloPrivati}
            onChange={(e) => set('soloPrivati', e.target.checked)}
            className="accent-[var(--accent)]"
          />
          solo privati
        </label>
        <Kicker as="div" className="ml-auto whitespace-nowrap pb-2">
          {count} annunci
        </Kicker>
      </div>
    </div>
  );
}
