import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { ZoneSuggestion } from '../types';
import { Button } from '../ui/Button';
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
  /**
   * Cosa fa il clic su un quartiere. Prima un clic girava fra tre stati (tieni → scarta →
   * indifferente) e nessuno lo capiva senza leggere la riga d'aiuto: ora lo scegli prima, in chiaro.
   */
  const [modo, setModo] = useState<'keep' | 'avoid' | 'none'>('keep');

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

  /** Applica il modo scelto; un secondo clic nello stesso modo lo toglie. */
  const ruota = (z: string): void => {
    const s = stato(z);
    if (modo === 'none' || s === modo) onChange({ keep: senza(keep, z), avoid: senza(avoid, z) });
    else if (modo === 'keep') onChange({ keep: [...keep, z], avoid: senza(avoid, z) });
    else onChange({ keep: senza(keep, z), avoid: [...avoid, z] });
  };

  const MODI = [
    { id: 'keep' as const, label: 'Tieni', on: 'bg-ok-soft text-ok border-ok/40' },
    { id: 'avoid' as const, label: 'Evita', on: 'bg-danger-soft text-danger border-danger/40' },
    { id: 'none' as const, label: 'Togli la scelta', on: 'bg-surface-3 text-ink border-line' },
  ];

  const zone = sug?.zones ?? [];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-ink-soft">Un clic su un quartiere lo segna come</span>
        <div role="radiogroup" aria-label="Cosa fa il clic" className="inline-flex gap-1">
          {MODI.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={modo === m.id}
              onClick={() => setModo(m.id)}
              className={cx(
                'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                modo === m.id ? m.on : 'border-hair text-muted hover:text-ink',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
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
                    'rounded-full border px-2.5 py-1 text-xs transition-colors',
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
            Verde = preferito, rosso = da evitare, grigio = indifferente. Li pesa l'AI: l'area
            disegnata sulla mappa invece scarta davvero.
          </p>
        </>
      )}
    </div>
  );
}
