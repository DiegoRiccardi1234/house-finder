import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { ZoneSuggestion } from '../types';
import { Button } from '../ui/Button';
import { Kicker } from '../ui/Kicker';
import { cx } from '../ui/cx';

/**
 * I quartieri da spuntare, invece che da digitare a memoria.
 *
 * È il punto che ha fatto dire «non ci sto capendo nulla»: due caselle vuote con scritto
 * *"Crocetta, Cit Turin…"* e nessun modo di sapere quali fossero gli altri. Qui l'elenco arriva
 * già pronto — incluso nell'app dove c'è, chiesto all'AI dove non c'è — e ogni voce si assegna
 * con un clic a *tieni* o *scarta*.
 *
 * Restano modificabili a mano: nessun elenco conosce il nome con cui **tu** chiami quella zona.
 */
export function ZoneSuggest({
  city,
  keep,
  avoid,
  onChange,
}: {
  city: string;
  keep: string[];
  avoid: string[];
  onChange: (patch: { keep?: string[]; avoid?: string[] }) => void;
}) {
  const [sug, setSug] = useState<ZoneSuggestion | null>(null);
  const [busy, setBusy] = useState(false);

  const carica = useCallback(async () => {
    setBusy(true);
    try {
      setSug(await api.zoneSuggestions(city));
    } catch {
      setSug({ city, zones: [], source: 'nessuna', detail: 'Elenco non disponibile.' });
    } finally {
      setBusy(false);
    }
  }, [city]);

  // L'elenco incluso è immediato e gratuito: si carica da sé. Quello dell'AI costa una chiamata,
  // quindi lo si chiede solo se il primo è vuoto e l'utente preme il pulsante.
  useEffect(() => {
    setSug(null);
    void carica();
  }, [carica]);

  const stato = (z: string): 'keep' | 'avoid' | null =>
    keep.includes(z) ? 'keep' : avoid.includes(z) ? 'avoid' : null;

  const senza = (list: string[], z: string): string[] => list.filter((x) => x !== z);

  /** Un clic gira fra i tre stati: indifferente → tieni → scarta → indifferente. */
  const ruota = (z: string): void => {
    const s = stato(z);
    if (s === null) onChange({ keep: [...keep, z], avoid: senza(avoid, z) });
    else if (s === 'keep') onChange({ keep: senza(keep, z), avoid: [...avoid, z] });
    else onChange({ keep: senza(keep, z), avoid: senza(avoid, z) });
  };

  const zone = sug?.zones ?? [];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <Kicker as="div">quartieri</Kicker>
        <span className="text-xs text-faint">
          Un clic per tenerlo, due per scartarlo, tre per lasciarlo indifferente.
        </span>
      </div>

      {busy && <p className="text-xs text-muted">Cerco i quartieri…</p>}

      {!busy && zone.length === 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted">{sug?.detail ?? 'Nessun elenco per questa città.'}</p>
          <Button size="sm" variant="ghost" onClick={() => void carica()}>
            Riprova
          </Button>
        </div>
      )}

      {zone.length > 0 && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {zone.map((z) => {
              const s = stato(z);
              return (
                <button
                  key={z}
                  type="button"
                  onClick={() => ruota(z)}
                  aria-pressed={s !== null}
                  className={cx(
                    'rounded-full border px-2 py-0.5 text-[0.7rem] transition-colors',
                    s === 'keep' && 'border-transparent bg-ok-soft text-ok',
                    s === 'avoid' && 'border-transparent bg-danger-soft text-danger line-through',
                    s === null && 'border-hair bg-surface-3 text-muted hover:text-ink',
                  )}
                >
                  {z}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-faint">
            {sug?.source === 'ai'
              ? 'Elenco proposto dall\'AI: correggilo pure, non è vangelo.'
              : 'Elenco incluso nell\'app.'}{' '}
            Verde = tieni · rosso = scarta · grigio = non filtra.
          </p>
        </>
      )}
    </div>
  );
}
