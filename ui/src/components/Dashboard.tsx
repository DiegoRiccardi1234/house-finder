import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useListings } from '../hooks';
import { api } from '../api';
import type { ChannelMeta, CityOption, ListingFilters, Profile, SearchProfile } from '../types';
import { FilterBar } from './FilterBar';
import { ListingCard } from './ListingCard';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';

const PAGE = 48;

// La mappa porta con sé Leaflet: si scarica solo quando la si apre.
const ListingsMap = lazy(() => import('./map/ListingsMap'));

/**
 * Si parte da «Da vedere»: tutto tranne gli scartati. Prima si partiva da «Tutti», e i 32
 * trilocali scartati il 24/11 restavano in lista, solo sbiaditi — sembravano trovati di nuovo.
 */
export const DEFAULT_FILTERS: ListingFilters = {
  channel: '',
  status: 'active',
  city: '',
  minScore: 0,
  sort: 'score',
  q: '',
  arredato: '',
  soloPrivati: false,
  priceMin: '',
  priceMax: '',
  sqmMin: '',
  sqmMax: '',
  rooms: [],
  bagni: '',
  piano: [],
  ascensore: false,
  aria: false,
  autonomo: false,
  days: '',
  maxKm: '',
  inArea: false,
  withoutGeo: true,
};

/** Quanti filtri sono diversi dal punto di partenza: si mostra sul pulsante «Filtra». */
export function activeFilterCount(f: ListingFilters): number {
  const d = DEFAULT_FILTERS;
  let n = 0;
  for (const k of Object.keys(d) as (keyof ListingFilters)[]) {
    if (k === 'sort' || k === 'withoutGeo') continue;
    const a = f[k];
    const b = d[k];
    if (Array.isArray(a) ? a.length > 0 : a !== b) n++;
  }
  return n;
}


export function Dashboard({
  filters,
  onFilters,
  refreshToken,
  channels,
  onGoToRun,
  runRunning,
  runSynchronized,
  onArchiveChanged,
}: {
  filters: ListingFilters;
  onFilters: (f: ListingFilters) => void;
  refreshToken: number;
  channels: ChannelMeta[];
  onGoToRun: () => void;
  runRunning: boolean;
  runSynchronized: boolean;
  onArchiveChanged: () => void;
}) {
  const { items, autoDismissed, total, loading, error, actionError, refresh, setStatus } = useListings(filters, refreshToken, onArchiveChanged);
  const [searches, setSearches] = useState<SearchProfile[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [cities, setCities] = useState<CityOption[]>([]);
  const [shown, setShown] = useState(PAGE);
  const [vista, setVista] = useState<'lista' | 'mappa'>('lista');

  useEffect(() => {
    api.getSearches().then(setSearches).catch(() => setSearches([]));
    api.cities().then(setCities).catch(() => setCities([]));
  }, []);
  // Il profilo serve per il nome del riferimento e il messaggio «Da chiedere»: si rilegge quando
  // l'archivio cambia (dopo un salvataggio della ricerca le regole possono aver spostato annunci).
  useEffect(() => {
    api.getProfile().then((s) => setProfile(s.profile)).catch(() => setProfile(null));
  }, [refreshToken]);

  const zones = profile?.zones ?? [];
  const refOf = (city?: string | null) => (city ? zones.find((z) => z.city === city)?.riferimento : undefined) ?? zones.find((z) => z.riferimento)?.riferimento;
  const hasReference = zones.some((z) => z.riferimento);
  const hasArea = zones.some((z) => (z.area?.polygon.length ?? 0) >= 3);

  // Cambiando filtro si riparte dalla prima pagina, altrimenti si eredita uno scroll senza senso.
  useEffect(() => setShown(PAGE), [filters]);

  const visible = useMemo(() => items.slice(0, shown), [items, shown]);

  // I filtri servono a chi ha già degli annunci. Su un archivio vuoto erano otto controlli in
  // faccia a chi non ne aveva ancora nessuno — la prima cosa che si vedeva aprendo l'app.
  const haAnnunci = total > 0;

  return (
    <div className="flex flex-col gap-4">
      {runRunning && (
        <Alert tone="info" title="Scansione in corso">
          Puoi leggere gli annunci; Preferito, Contattato e Scarta tornano disponibili a fine scansione.
        </Alert>
      )}
      {!runSynchronized && <p role="status" className="text-xs text-muted">Sincronizzo lo stato della scansione…</p>}
      {actionError && <Alert tone="warn" title="Stato non aggiornato">{actionError}</Alert>}
      {haAnnunci && (
        <div className="flex flex-col gap-3">
          <FilterBar
            filters={filters}
            onChange={onFilters}
            count={items.length}
            hidden={autoDismissed}
            searches={searches}
            channels={channels}
            cities={cities}
            hasReference={hasReference}
            hasArea={hasArea}
          />
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Vista" className="inline-flex rounded-[var(--radius-btn)] border border-line p-0.5">
              {(['lista', 'mappa'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={vista === v}
                  onClick={() => setVista(v)}
                  className={vista === v ? 'rounded-[var(--radius-btn)] bg-accent px-3 py-1 text-sm text-on-accent' : 'px-3 py-1 text-sm text-muted hover:text-ink'}
                >
                  {v === 'lista' ? 'Lista' : 'Mappa'}
                </button>
              ))}
            </div>
            {activeFilterCount(filters) > 0 && (
              <Button size="sm" variant="ghost" onClick={() => onFilters({ ...DEFAULT_FILTERS, sort: filters.sort })}>
                Azzera i filtri
              </Button>
            )}
            <Button size="sm" onClick={refresh} loading={loading} className="ml-auto">
              Aggiorna
            </Button>
          </div>
        </div>
      )}

      {error && (
        <Alert
          tone="danger"
          title="Non riesco a leggere l'archivio"
          action={
            <Button size="sm" onClick={refresh}>
              Riprova
            </Button>
          }
        >
          {error}. Il server non risponde: se l'hai chiuso, riaprilo dall'icona in basso a destra.
        </Alert>
      )}

      {items.length === 0 && !loading ? (
        total > 0 ? (
          <EmptyState
            kicker="nessun risultato"
            title="Nessun annuncio con questi filtri"
            action={
              <Button variant="secondary" onClick={() => onFilters(DEFAULT_FILTERS)}>
                Azzera i filtri
              </Button>
            }
          >
            L'archivio non è vuoto: sono i filtri a essere troppo stretti. Prova a togliere qualche
            filtro, oppure guarda fra gli scartati in automatico dal tuo profilo.
          </EmptyState>
        ) : (
          <EmptyState
            kicker="archivio vuoto"
            title="Non c'è ancora nessun annuncio"
            action={
              <Button variant="primary" onClick={onGoToRun}>
                Vai a Cerca
              </Button>
            }
          >
            Lancia una ricerca: apre i portali e raccoglie gli annunci che rispettano i tuoi
            criteri. Il canale email funziona solo se hai già creato, sui siti dei portali, delle
            ricerche salvate che ti mandano un avviso via mail.
          </EmptyState>
        )
      ) : vista === 'mappa' ? (
        <Suspense fallback={<p className="text-sm text-muted">Carico la mappa…</p>}>
          <ListingsMap items={items} zones={zones} />
        </Suspense>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map((rec) => (
              <ListingCard
                key={rec.key}
                rec={rec}
                onStatus={setStatus}
                statusDisabled={runRunning || !runSynchronized}
                refLabel={refOf(rec.city)?.label}
                tenant={profile?.tenant}
              />
            ))}
          </div>
          {shown < items.length && (
            <div className="flex justify-center">
              <Button variant="secondary" onClick={() => setShown((n) => n + PAGE)}>
                Carica altri ({items.length - shown})
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
