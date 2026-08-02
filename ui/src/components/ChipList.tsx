import { useState } from 'react';
import { Badge } from '../ui/Badge';
import { Input } from '../ui/Field';
import { Kicker } from '../ui/Kicker';

/**
 * Una lista di etichette che si aggiungono scrivendo e si tolgono cliccando.
 *
 * È la forma giusta per i quartieri: sono tanti, si aggiungono uno alla volta e si cambia idea
 * spesso. Prima erano una riga di prosa dentro un blocco markdown, ed erano modificabili solo
 * riscrivendo la frase attorno senza rompere la punteggiatura che il parser si aspettava.
 */
export function ChipList({
  label,
  hint,
  tone = 'neutral',
  values,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: string;
  tone?: 'ok' | 'danger' | 'neutral';
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [testo, setTesto] = useState('');

  const aggiungi = (): void => {
    // Si accetta anche un elenco incollato: chi arriva da un file di testo ha le virgole in mano.
    const nuovi = testo
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (nuovi.length === 0) return;
    onChange(Array.from(new Set([...values, ...nuovi])));
    setTesto('');
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Kicker as="div">{label}</Kicker>
      {hint && <p className="text-xs text-faint">{hint}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        {values.map((v) => (
          <button
            key={v}
            type="button"
            title="Togli"
            onClick={() => onChange(values.filter((x) => x !== v))}
            className="group"
          >
            <Badge tone={tone}>
              {v}
              <span className="opacity-40 group-hover:opacity-100">×</span>
            </Badge>
          </button>
        ))}
        {values.length === 0 && <span className="text-xs text-faint">nessuno</span>}
      </div>
      <Input
        value={testo}
        placeholder={placeholder ?? 'Scrivi e premi Invio'}
        onChange={(e) => setTesto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            aggiungi();
          }
        }}
        onBlur={aggiungi}
        className="max-w-sm"
      />
    </div>
  );
}
