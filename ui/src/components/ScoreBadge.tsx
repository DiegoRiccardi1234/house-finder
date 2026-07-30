import type { AiScore } from '../types';

/**
 * Voto AI. Il colore da solo non basta (verde/rosso è il caso classico di
 * fallimento per i daltonici): la fascia è indicata anche da una forma, il numero
 * è sempre leggibile e `aria-label` dice tutto per esteso, `worthVisit` compreso.
 */
function band(score: number): { label: string; mark: string; cls: string } {
  if (score >= 75) return { label: 'alto', mark: '▲', cls: 'bg-ok-soft text-ok border-ok/40' };
  if (score >= 50) return { label: 'medio', mark: '■', cls: 'bg-warn-soft text-warn border-warn/40' };
  return { label: 'basso', mark: '▼', cls: 'bg-danger-soft text-danger border-danger/40' };
}

export function ScoreBadge({ ai }: { ai: AiScore | null }) {
  if (!ai) {
    return (
      <span
        aria-label="Non ancora valutato dall'AI"
        className="inline-flex h-9 min-w-9 items-center justify-center rounded-[var(--radius-btn)] border border-hair bg-surface-3 px-2 text-sm font-bold text-faint"
      >
        –
      </span>
    );
  }
  const b = band(ai.score);
  return (
    <span
      aria-label={`Voto ${ai.score} su 100, fascia ${b.label}. ${ai.worthVisit ? 'Vale una visita' : 'Non prioritaria'}`}
      className={`inline-flex h-9 items-center gap-1 rounded-[var(--radius-btn)] border px-2 ${b.cls}`}
    >
      <span aria-hidden="true" className="text-[0.6rem] leading-none">
        {b.mark}
      </span>
      <span className="text-sm font-extrabold tabular-nums leading-none">{ai.score}</span>
      {ai.worthVisit && (
        <span
          aria-hidden="true"
          title="Vale una visita"
          className="ml-0.5 h-1.5 w-1.5 rounded-full bg-current"
        />
      )}
    </span>
  );
}
