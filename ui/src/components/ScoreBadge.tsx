import type { AiScore } from '../types';

function color(score: number): string {
  if (score >= 75) return 'bg-emerald-600 text-white';
  if (score >= 50) return 'bg-amber-500 text-white';
  return 'bg-rose-600 text-white';
}

export function ScoreBadge({ ai }: { ai: AiScore | null }) {
  if (!ai) {
    return (
      <span className="inline-flex h-9 min-w-9 items-center justify-center rounded-lg bg-stone-300 px-2 text-sm font-bold text-stone-600 dark:bg-stone-700 dark:text-stone-300">
        –
      </span>
    );
  }
  return (
    <span
      title={ai.worthVisit ? 'Vale una visita' : 'Non prioritaria'}
      className={`inline-flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-sm font-bold ${color(ai.score)}`}
    >
      {ai.score}
    </span>
  );
}
