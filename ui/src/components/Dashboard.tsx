import { useEffect, useMemo, useState } from 'react';
import { useListings } from '../hooks';
import { api } from '../api';
import type { ChannelMeta, ListingFilters, SearchProfile } from '../types';
import { FilterBar } from './FilterBar';
import { ListingCard } from './ListingCard';
import { Alert } from '../ui/Alert';
import { Kicker } from '../ui/Kicker';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';

const PAGE = 48;

export const DEFAULT_FILTERS: ListingFilters = {
  channel: '',
  status: '',
  city: '',
  minScore: 0,
  sort: 'score',
  q: '',
  arredato: '',
  soloPrivati: false,
};

const isFiltered = (f: ListingFilters) =>
  Boolean(f.q || f.city || f.channel || f.status || f.arredato || f.soloPrivati || f.minScore > 0);

export function Dashboard({
  filters,
  onFilters,
  refreshToken,
  channels,
  onGoToRun,
}: {
  filters: ListingFilters;
  onFilters: (f: ListingFilters) => void;
  refreshToken: number;
  channels: ChannelMeta[];
  onGoToRun: () => void;
}) {
  const { items, loading, error, refresh, setStatus } = useListings(filters, refreshToken);
  const [searches, setSearches] = useState<SearchProfile[]>([]);
  const [shown, setShown] = useState(PAGE);
  const [mostraFiltri, setMostraFiltri] = useState(false);

  useEffect(() => {
    api.getSearches().then(setSearches).catch(() => setSearches([]));
  }, []);

  // Cambiando filtro si riparte dalla prima pagina, altrimenti si eredita uno scroll senza senso.
  useEffect(() => setShown(PAGE), [filters]);

  const visible = useMemo(() => items.slice(0, shown), [items, shown]);

  // I filtri servono a chi ha già degli annunci. Su un archivio vuoto erano otto controlli in
  // faccia a chi non ne aveva ancora nessuno — la prima cosa che si vedeva aprendo l'app.
  const haAnnunci = items.length > 0 || isFiltered(filters);

  return (
    <div className="flex flex-col gap-4">
      {haAnnunci && (
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {mostraFiltri ? (
              <FilterBar
                filters={filters}
                onChange={onFilters}
                count={items.length}
                searches={searches}
                channels={channels}
              />
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm" variant="secondary" onClick={() => setMostraFiltri(true)}>
                  Filtra
                </Button>
                <Kicker>{items.length} annunci</Kicker>
              </div>
            )}
          </div>
          <Button onClick={refresh} loading={loading} className={mostraFiltri ? 'mt-5 shrink-0' : 'shrink-0'}>
            Aggiorna
          </Button>
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
        isFiltered(filters) ? (
          <EmptyState
            kicker="nessun risultato"
            title="Nessun annuncio con questi filtri"
            action={
              <Button variant="secondary" onClick={() => onFilters(DEFAULT_FILTERS)}>
                Azzera i filtri
              </Button>
            }
          >
            L'archivio non è vuoto: sono i filtri a essere troppo stretti. Prova ad abbassare il voto
            minimo o a togliere la città.
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
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map((rec) => (
              <ListingCard key={rec.key} rec={rec} onStatus={setStatus} />
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
