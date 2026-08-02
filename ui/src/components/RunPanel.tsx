import { useEffect, useRef, useState } from 'react';
import { useRunStream } from '../hooks';
import type { Meta } from '../types';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { Kicker } from '../ui/Kicker';
import { cx } from '../ui/cx';

/**
 * La schermata da cui parte una scansione.
 *
 * Tre cose erano al contrario: si preselezionava **email**, cioè il canale che richiede più
 * lavoro fuori dall'app (creare gli avvisi sui portali) ed è quello quasi certamente non pronto
 * al primo avvio; il pulsante si spegneva senza dire perché; e a fine scansione il riepilogo —
 * che il server manda — veniva buttato via, lasciando come unica traccia un "Run conclusa".
 */
export function RunPanel({
  meta,
  onDone,
  onVediAnnunci,
}: {
  meta: Meta | null;
  onDone: () => void;
  onVediAnnunci: () => void;
}) {
  const { lines, running, summary, start } = useRunStream(onDone);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  const channels = meta?.channels ?? [];

  // Si spuntano i canali **pronti**, non uno deciso a tavolino. Finché `meta` non è arrivato non
  // si sceglie niente: preselezionare e poi correggersi farebbe lampeggiare le caselle.
  useEffect(() => {
    if (selected !== null || channels.length === 0) return;
    setSelected(new Set(channels.filter((c) => c.available).map((c) => c.id)));
  }, [channels, selected]);

  const scelti = selected ?? new Set<string>();
  const toggle = (id: string): void =>
    setSelected(() => {
      const next = new Set(scelti);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const usable = [...scelti].filter((id) => channels.find((c) => c.id === id)?.available);
  const nessunoPronto = channels.length > 0 && channels.every((c) => !c.available);

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <Card className="flex flex-col">
        <CardHeader kicker="da dove" title="Canali" />
        <div className="flex flex-col gap-2 p-4">
          {/* Prima del pulsante, non dopo: è quello che sta per succedere sullo schermo. */}
          <p className="text-xs text-faint">
            Subito, Immobiliare, Idealista e Facebook si leggono aprendo una finestra del browser
            sul computer, per un paio di minuti. Il canale email no.
          </p>

          {channels.map((c) => (
            <label
              key={c.id}
              className={cx(
                'flex items-start gap-2 text-sm',
                c.available ? 'text-ink-soft' : 'text-faint',
              )}
            >
              <input
                type="checkbox"
                checked={scelti.has(c.id)}
                disabled={!c.available}
                onChange={() => toggle(c.id)}
                className="mt-1 accent-[var(--accent)]"
              />
              <span className="flex-1">
                {c.label}
                {!c.available && <span className="block text-xs text-faint">{c.reason}</span>}
              </span>
            </label>
          ))}

          <Button
            variant="primary"
            onClick={() => start(usable)}
            loading={running}
            disabled={usable.length === 0}
            className="mt-2 w-full"
          >
            {running ? 'Scansione in corso' : 'Cerca adesso'}
          </Button>

          {/* Un pulsante spento senza spiegazione è indistinguibile da un pulsante rotto. */}
          {!running && usable.length === 0 && (
            <p className="text-xs text-warn">
              {nessunoPronto
                ? 'Nessun canale è pronto: guarda i motivi qui sopra e sistemali in Config.'
                : 'Spunta almeno un canale.'}
            </p>
          )}
        </div>
      </Card>

      <div className="flex flex-col gap-4">
        {summary && !running && (
          <Alert
            tone={summary.nuovi > 0 ? 'ok' : 'info'}
            title={
              summary.nuovi > 0
                ? `${summary.nuovi} annunci nuovi`
                : 'Nessun annuncio nuovo questa volta'
            }
            action={
              summary.nuovi > 0 ? (
                <Button size="sm" variant="primary" onClick={onVediAnnunci}>
                  Vedili
                </Button>
              ) : undefined
            }
          >
            {summary.visti} annunci letti in totale su {summary.canali} canali.
          </Alert>
        )}

        <Card className="overflow-hidden">
          <CardHeader
            kicker="dal vivo"
            title="Cosa sta facendo"
            action={running ? <Kicker tone="accent">in corso</Kicker> : undefined}
          />
          <div
            ref={logRef}
            role="log"
            aria-live="polite"
            aria-label="Avanzamento della ricerca"
            className="h-[52vh] overflow-y-auto bg-console p-4 font-mono text-xs leading-relaxed text-console-ink"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {lines.length === 0 ? (
              <p className="opacity-60">
                Qui compare l'avanzamento, riga per riga, mentre la ricerca gira.
              </p>
            ) : (
              lines.map((l, i) => (
                <div key={i} className="whitespace-pre-wrap">
                  {l}
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
