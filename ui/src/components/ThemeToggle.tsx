import { useTheme, type ThemeChoice } from '../theme';
import { cx } from '../ui/cx';

const OPTIONS: { id: ThemeChoice; label: string; glyph: string }[] = [
  { id: 'light', label: 'Tema chiaro', glyph: '☀' },
  { id: 'dark', label: 'Tema scuro', glyph: '☾' },
  { id: 'system', label: 'Segui il sistema', glyph: '⌁' },
];

export function ThemeToggle() {
  const { choice, setChoice } = useTheme();
  return (
    <div
      role="group"
      aria-label="Tema"
      className="flex items-center gap-0.5 rounded-[var(--radius-btn)] border border-hair bg-surface-2 p-0.5"
    >
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          onClick={() => setChoice(o.id)}
          aria-label={o.label}
          aria-pressed={choice === o.id}
          title={o.label}
          className={cx(
            'h-6 w-7 rounded-[3px] text-xs leading-none transition-colors duration-150',
            choice === o.id ? 'bg-accent text-on-accent' : 'text-muted hover:text-ink',
          )}
        >
          <span aria-hidden="true">{o.glyph}</span>
        </button>
      ))}
    </div>
  );
}
