import { useState } from 'react';
import type { ListingFilters, SearchProfile, ChannelMeta, CityOption } from '../types';
import { Field, Input, Select } from '../ui/Field';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';

/**
 * I filtri degli annunci, sul modello di Immobiliare: in vista quelli che si usano sempre
 * (prezzo, locali, stato, ordine), il resto dietro «Altri filtri».
 *
 * Un dato che l'annuncio non dichiara non lo esclude dalle misure (prezzo, m², locali): su
 * Facebook il prezzo manca spesso e sparirebbero proprio i privati. Le caratteristiche
 * (ascensore, piano…) invece valgono solo se dichiarate. La regola è scritta sotto i campi.
 */

/** Pulsante on/off a forma di pastiglia: per scelte multiple corte (locali, piano). */
function Toggle({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={cx(
        'min-h-[34px] min-w-[38px] rounded-[var(--radius-btn)] border px-2.5 text-sm transition-colors duration-150',
        on ? 'border-accent bg-accent text-on-accent' : 'border-line bg-surface-hi text-ink-soft hover:border-accent/60',
      )}
    >
      {children}
    </button>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink-soft">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--accent)]" />
      {children}
    </label>
  );
}

/** Due campi numerici affiancati: "da" e "a". */
function Range({
  label,
  unit,
  min,
  max,
  onMin,
  onMax,
  step,
}: {
  label: string;
  unit: string;
  min: string;
  max: string;
  onMin: (v: string) => void;
  onMax: (v: string) => void;
  step?: number;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1">
      <legend className="mb-1 text-xs font-medium text-ink-soft">{label}</legend>
      <div className="flex items-center gap-1.5">
        <Input aria-label={`${label} minimo`} inputMode="numeric" type="number" min={0} step={step} placeholder="da" value={min} onChange={(e) => onMin(e.target.value)} />
        <span className="text-faint">–</span>
        <Input aria-label={`${label} massimo`} inputMode="numeric" type="number" min={0} step={step} placeholder="a" value={max} onChange={(e) => onMax(e.target.value)} />
        <span className="shrink-0 text-xs text-faint">{unit}</span>
      </div>
    </fieldset>
  );
}

const ROOMS: { n: number; label: string; aria: string }[] = [
  { n: 1, label: '1', aria: 'monolocale' },
  { n: 2, label: '2', aria: 'bilocale' },
  { n: 3, label: '3', aria: 'trilocale' },
  { n: 4, label: '4+', aria: 'quattro locali o più' },
];

const FLOORS: { id: string; label: string }[] = [
  { id: 'terra', label: 'Terra' },
  { id: 'intermedio', label: 'Intermedi' },
  { id: 'ultimo', label: 'Ultimo' },
];

export function FilterBar({
  filters,
  onChange,
  count,
  hidden,
  searches,
  channels,
  cities,
  hasReference,
  hasArea,
}: {
  filters: ListingFilters;
  onChange: (f: ListingFilters) => void;
  count: number;
  /** Annunci tolti dalle regole del profilo: si dice quanti sono, non si nascondono in silenzio. */
  hidden: number;
  /** Le città vengono dai profili di ricerca configurati, non da una lista fissa. */
  searches: SearchProfile[];
  channels: ChannelMeta[];
  cities: CityOption[];
  hasReference: boolean;
  hasArea: boolean;
}) {
  const [more, setMore] = useState(false);
  const set = <K extends keyof ListingFilters>(k: K, v: ListingFilters[K]) => onChange({ ...filters, [k]: v });
  const toggleIn = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const citySlugs = Array.from(new Set(searches.map((s) => s.city)));
  const labelOf = (slug: string) => cities.find((c) => c.slug === slug)?.label ?? slug;
  const extra = [
    filters.sqmMin, filters.sqmMax, filters.bagni, filters.days, filters.maxKm, filters.city, filters.channel, filters.arredato,
  ].filter(Boolean).length
    + filters.piano.length
    + [filters.ascensore, filters.aria, filters.autonomo, filters.soloPrivati, filters.inArea].filter(Boolean).length
    + (filters.minScore > 0 ? 1 : 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(12rem,1.3fr)_minmax(14rem,1.2fr)_auto_minmax(9rem,0.8fr)_minmax(9rem,0.8fr)]">
        <Field label="Cerca">
          {(p) => (
            <Input {...p} type="search" placeholder="via, zona, parola…" value={filters.q} onChange={(e) => set('q', e.target.value)} />
          )}
        </Field>

        <Range label="Prezzo" unit="€/mese" step={50} min={filters.priceMin} max={filters.priceMax} onMin={(v) => set('priceMin', v)} onMax={(v) => set('priceMax', v)} />

        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-xs font-medium text-ink-soft">Locali</legend>
          <div className="flex gap-1">
            {ROOMS.map((r) => (
              <Toggle key={r.n} label={r.aria} on={filters.rooms.includes(r.n)} onClick={() => set('rooms', toggleIn(filters.rooms, r.n))}>
                {r.label}
              </Toggle>
            ))}
          </div>
        </fieldset>

        <Field label="Stato">
          {(p) => (
            <Select {...p} value={filters.status} onChange={(e) => set('status', e.target.value)}>
              <option value="active">Da vedere</option>
              <option value="ask">Da chiedere</option>
              <option value="new">Nuovi</option>
              <option value="favorite">Preferiti</option>
              <option value="contacted">Contattati</option>
              <option value="dismissed">Scartati</option>
              <option value="">Tutti, anche scartati</option>
            </Select>
          )}
        </Field>

        <Field label="Ordina per">
          {(p) => (
            <Select {...p} value={filters.sort} onChange={(e) => set('sort', e.target.value as ListingFilters['sort'])}>
              <option value="score">Voto più alto</option>
              <option value="recent">Più recenti</option>
              <option value="price">Prezzo più basso</option>
              {hasReference && <option value="distance">Più vicini</option>}
            </Select>
          )}
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button size="sm" variant="secondary" aria-expanded={more} onClick={() => setMore((v) => !v)}>
          {more ? 'Meno filtri' : extra ? `Altri filtri (${extra})` : 'Altri filtri'}
        </Button>
        <p className="text-sm text-muted" role="status">
          <b className="font-medium text-ink">{count}</b> annunci
          {hidden > 0 && filters.status === 'active' && (
            <>
              {' '}· {hidden} scartati in automatico dal tuo profilo{' '}
              <button type="button" className="underline underline-offset-2 hover:text-accent" onClick={() => set('status', 'dismissed')}>
                vedi
              </button>
            </>
          )}
        </p>
      </div>

      {more && (
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 rounded-[var(--radius-btn)] border border-hair bg-surface-2 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Range label="Superficie" unit="m²" step={5} min={filters.sqmMin} max={filters.sqmMax} onMin={(v) => set('sqmMin', v)} onMax={(v) => set('sqmMax', v)} />

          <Field label="Bagni">
            {(p) => (
              <Select {...p} value={filters.bagni} onChange={(e) => set('bagni', e.target.value)}>
                <option value="">Qualsiasi</option>
                <option value="1">Almeno 1</option>
                <option value="2">Almeno 2</option>
              </Select>
            )}
          </Field>

          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-xs font-medium text-ink-soft">Piano</legend>
            <div className="flex flex-wrap gap-1">
              {FLOORS.map((f) => (
                <Toggle key={f.id} on={filters.piano.includes(f.id)} onClick={() => set('piano', toggleIn(filters.piano, f.id))}>
                  {f.label}
                </Toggle>
              ))}
            </div>
          </fieldset>

          <Field label="Arredamento">
            {(p) => (
              <Select {...p} value={filters.arredato} onChange={(e) => set('arredato', e.target.value)}>
                <option value="">Qualsiasi</option>
                <option value="sì">Arredato</option>
                <option value="parziale">Parzialmente arredato</option>
                <option value="no">Non arredato</option>
              </Select>
            )}
          </Field>

          <fieldset className="flex flex-col gap-1.5 lg:col-span-2">
            <legend className="mb-1 text-xs font-medium text-ink-soft">Caratteristiche (solo se l'annuncio le dichiara)</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              <Check checked={filters.ascensore} onChange={(v) => set('ascensore', v)}>Ascensore</Check>
              <Check checked={filters.aria} onChange={(v) => set('aria', v)}>Aria condizionata</Check>
              <Check checked={filters.autonomo} onChange={(v) => set('autonomo', v)}>Riscaldamento autonomo</Check>
              <Check checked={filters.soloPrivati} onChange={(v) => set('soloPrivati', v)}>Solo privati</Check>
            </div>
          </fieldset>

          <Field label="Trovati">
            {(p) => (
              <Select {...p} value={filters.days} onChange={(e) => set('days', e.target.value)}>
                <option value="">In qualsiasi momento</option>
                <option value="1">Nelle ultime 24 ore</option>
                <option value="3">Negli ultimi 3 giorni</option>
                <option value="7">Nell'ultima settimana</option>
                <option value="14">Nelle ultime 2 settimane</option>
              </Select>
            )}
          </Field>

          <Field label={`Voto minimo: ${filters.minScore}`}>
            {(p) => (
              <input {...p} type="range" min={0} max={100} step={5} value={filters.minScore} onChange={(e) => set('minScore', Number(e.target.value))} className="mt-2 w-full accent-[var(--accent)]" />
            )}
          </Field>

          {(hasReference || hasArea) && (
            <fieldset className="flex flex-col gap-2 lg:col-span-2">
              <legend className="mb-1 text-xs font-medium text-ink-soft">Posizione</legend>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                {hasReference && (
                  <label className="flex items-center gap-2 text-sm text-ink-soft">
                    Entro
                    <Input aria-label="Distanza massima in km" type="number" min={0} step={0.5} className="w-20" value={filters.maxKm} onChange={(e) => set('maxKm', e.target.value)} />
                    km dal riferimento
                  </label>
                )}
                {hasArea && <Check checked={filters.inArea} onChange={(v) => set('inArea', v)}>Solo dentro l'area disegnata</Check>}
                {(filters.maxKm || filters.inArea) && (
                  <Check checked={filters.withoutGeo} onChange={(v) => set('withoutGeo', v)}>Tieni chi non dice la via</Check>
                )}
              </div>
            </fieldset>
          )}

          {citySlugs.length > 1 && (
            <Field label="Città">
              {(p) => (
                <Select {...p} value={filters.city} onChange={(e) => set('city', e.target.value)}>
                  <option value="">Tutte</option>
                  {citySlugs.map((c) => (
                    <option key={c} value={c}>{labelOf(c)}</option>
                  ))}
                </Select>
              )}
            </Field>
          )}

          <Field label="Fonte">
            {(p) => (
              <Select {...p} value={filters.channel} onChange={(e) => set('channel', e.target.value)}>
                <option value="">Tutte</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </Select>
            )}
          </Field>

          <p className="text-xs text-faint sm:col-span-2 lg:col-span-4">
            Prezzo, superficie e locali: un annuncio che non li dichiara resta in lista (succede spesso su Facebook).
          </p>
        </div>
      )}
    </div>
  );
}
