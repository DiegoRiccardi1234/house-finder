import { useEffect, useRef, useState } from 'react';
import { useRunStream } from '../hooks';
import type { Meta } from '../types';

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

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <div className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
        <h2 className="font-semibold">Canali</h2>
        {channels.map((c) => (
          <label
            key={c.id}
            className={`flex items-center gap-2 text-sm ${c.available ? '' : 'opacity-50'}`}
            title={c.reason}
          >
            <input
              type="checkbox"
              checked={selected.has(c.id)}
              disabled={!c.available}
              onChange={() => toggle(c.id)}
            />
            <span className="flex-1">{c.label}</span>
            {!c.available && <span className="text-xs text-stone-400">{c.reason}</span>}
          </label>
        ))}
        <button
          onClick={() => start([...selected])}
          disabled={running || selected.size === 0}
          className="mt-2 rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? '⏳ Run in corso…' : '▶ Lancia ricerca'}
        </button>
        <p className="text-xs text-stone-500 dark:text-stone-400">
          Gli scraper browser (Subito/Immobiliare/Facebook) aprono una finestra Chrome reale sul PC per 1–3 minuti.
        </p>
      </div>

      <div
        ref={logRef}
        className="h-[60vh] overflow-y-auto rounded-2xl bg-stone-950 p-4 font-mono text-xs leading-relaxed text-stone-200"
      >
        {lines.length === 0 ? (
          <p className="text-stone-500">Nessun log. Lancia una ricerca per vedere l'avanzamento dal vivo.</p>
        ) : (
          lines.map((l, i) => (
            <div key={i} className="whitespace-pre-wrap">
              {l}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
