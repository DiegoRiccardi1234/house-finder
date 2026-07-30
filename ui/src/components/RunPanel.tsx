import { useEffect, useRef, useState } from 'react';
import { useRunStream } from '../hooks';
import type { Meta } from '../types';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { Kicker } from '../ui/Kicker';
import { cx } from '../ui/cx';

export function RunPanel({ meta, onDone }: { meta: Meta | null; onDone: () => void }) {
  const { lines, running, start } = useRunStream(onDone);
  const [selected, setSelected] = useState<Set<string>>(new Set(['email']));
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  const channels = meta?.channels ?? [];
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const usable = [...selected].filter((id) => channels.find((c) => c.id === id)?.available);

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <Card className="flex flex-col">
        <CardHeader kicker="da dove" title="Canali" />
        <div className="flex flex-col gap-2 p-4">
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
                checked={selected.has(c.id)}
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
            {running ? 'Run in corso' : 'Lancia ricerca'}
          </Button>

          <p className="text-xs text-faint">
            Gli scraper browser aprono una finestra Chrome reale sul PC per 1–3 minuti. Il canale email
            non usa il browser.
          </p>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          kicker="dal vivo"
          title="Log della run"
          action={running ? <Kicker tone="accent">in corso</Kicker> : undefined}
        />
        <div
          ref={logRef}
          role="log"
          aria-live="polite"
          aria-label="Log della ricerca"
          className="h-[60vh] overflow-y-auto bg-console p-4 font-mono text-xs leading-relaxed text-console-ink"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {lines.length === 0 ? (
            <p className="opacity-60">Nessun log. Lancia una ricerca per vedere l'avanzamento dal vivo.</p>
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
  );
}
