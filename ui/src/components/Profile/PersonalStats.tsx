import type { ChannelMeta, Stats } from '../../types';
import { Button } from '../../ui/Button';
import { Card, CardHeader } from '../../ui/Card';
import { Kicker } from '../../ui/Kicker';
import { Stat } from '../../ui/Stat';

const CHANNEL_LABEL: Record<string, string> = {
  email: 'Email',
  subito: 'Subito',
  immobiliare: 'Immobiliare',
  idealista: 'Idealista',
  facebook: 'Facebook',
  'fb-group': 'FB gruppi',
  'fb-marketplace': 'FB Marketplace',
};

const BUCKETS: { key: keyof Stats['scoreBuckets']; label: string; cls: string }[] = [
  { key: '75-100', label: '75-100', cls: 'bg-ok' },
  { key: '50-74', label: '50-74', cls: 'bg-warn' },
  { key: '25-49', label: '25-49', cls: 'bg-danger/70' },
  { key: '0-24', label: '0-24', cls: 'bg-danger' },
];

export function PersonalStats({
  stats,
  channels,
  onGoToRun,
}: {
  stats: Stats | null;
  channels: ChannelMeta[];
  onGoToRun: () => void;
}) {
  if (!stats) return <Card className="p-4 text-sm text-muted">Calcolo le statistiche…</Card>;

  if (stats.total === 0) {
    return (
      <Card>
        <CardHeader kicker="andamento" title="Statistiche" />
        <div className="p-4 text-sm text-muted">
          Archivio vuoto: non c'è ancora niente da misurare.{' '}
          <Button size="sm" variant="primary" onClick={onGoToRun} className="ml-2">
            Lancia una ricerca
          </Button>
        </div>
      </Card>
    );
  }

  const archived = stats.byStatus.favorite + stats.byStatus.contacted + stats.byStatus.dismissed;
  const maxBucket = Math.max(...BUCKETS.map((b) => stats.scoreBuckets[b.key]), 1);

  // Facebook arriva sotto tre etichette diverse a seconda di come è stato salvato il record:
  // sommarle evita di mostrare "0" accanto a un canale che ha invece prodotto annunci.
  const countFor = (id: string): number =>
    id === 'facebook'
      ? (stats.byChannel.facebook ?? 0) + (stats.byChannel['fb-group'] ?? 0) + (stats.byChannel['fb-marketplace'] ?? 0)
      : (stats.byChannel[id] ?? 0);
  const maxChannel = Math.max(...channels.map((c) => countFor(c.id)), 1);

  return (
    <Card>
      <CardHeader kicker="andamento" title="Statistiche" />

      <div className="grid gap-4 border-b border-hair p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="annunci trovati" value={stats.total} sub={`${stats.scored} valutati dall'AI`} />
        <Stat
          label="voto medio"
          value={stats.avgScore ?? '—'}
          tone="accent"
          sub={stats.scored ? `${stats.worthVisit} da visitare secondo l'AI` : 'nessun voto ancora'}
        />
        <Stat
          label="prezzo medio"
          value={stats.avgPrice != null ? `${stats.avgPrice} €` : '—'}
          sub={`su ${stats.withPrice} annunci con prezzo`}
        />
        <Stat
          label="ultimo aggiornamento"
          value={stats.lastSeen ? new Date(stats.lastSeen).toLocaleDateString('it-IT') : '—'}
          sub={stats.lastSeen ? new Date(stats.lastSeen).toLocaleTimeString('it-IT') : undefined}
        />
      </div>

      <div className="grid gap-6 p-4 md:grid-cols-2">
        <div>
          <Kicker as="div">la tua selezione</Kicker>
          {/* Un funnel di zeri sembra un bug: finché non archivi nulla, meglio un invito. */}
          {archived === 0 ? (
            <p className="mt-2 text-sm text-muted">
              {stats.total} annunci raccolti, nessuno ancora archiviato. Usa <b>Preferito</b>,{' '}
              <b>Contattato</b> e <b>Scarta</b> sulle card: da lì in poi qui vedi l'avanzamento.
            </p>
          ) : (
            <dl className="mt-2 grid grid-cols-4 gap-2">
              {(['new', 'favorite', 'contacted', 'dismissed'] as const).map((k) => (
                <div key={k}>
                  <dt>
                    <Kicker>
                      {k === 'new'
                        ? 'nuovi'
                        : k === 'favorite'
                          ? 'preferiti'
                          : k === 'contacted'
                            ? 'contattati'
                            : 'scartati'}
                    </Kicker>
                  </dt>
                  <dd className="text-xl font-extrabold tabular-nums text-ink">{stats.byStatus[k]}</dd>
                </div>
              ))}
            </dl>
          )}

          <div className="mt-4">
            <Kicker as="div">distribuzione dei voti</Kicker>
            <div className="mt-2 space-y-1">
              {BUCKETS.map((b) => {
                const n = stats.scoreBuckets[b.key];
                return (
                  <div key={b.key} className="flex items-center gap-2 text-xs">
                    <span className="w-14 shrink-0 tabular-nums text-muted">{b.label}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
                      <div className={`h-full ${b.cls}`} style={{ width: `${(n / maxBucket) * 100}%` }} />
                    </div>
                    <span className="w-8 shrink-0 text-right tabular-nums text-muted">{n}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div>
          <Kicker as="div">da quale canale</Kicker>
          <div className="mt-2 space-y-1">
            {channels.map((c) => {
              const n = countFor(c.id);
              return (
                <div key={c.id} className="flex items-center gap-2 text-xs">
                  <span className="w-24 shrink-0 truncate text-muted">{CHANNEL_LABEL[c.id] ?? c.label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
                    <div className="h-full bg-accent" style={{ width: `${(n / maxChannel) * 100}%` }} />
                  </div>
                  <span className="w-8 shrink-0 text-right tabular-nums text-muted">{n}</span>
                  {/* Un canale a zero *spiegato* è informazione; muto è un dubbio. */}
                  {n === 0 && !c.available && (
                    <span className="w-40 shrink-0 truncate text-[0.65rem] text-faint">{c.reason}</span>
                  )}
                </div>
              );
            })}
          </div>

          {Object.keys(stats.byCity).length > 0 && (
            <div className="mt-4">
              <Kicker as="div">città rilevate dall'AI</Kicker>
              <p className="mt-1 text-sm text-ink-soft">
                {Object.entries(stats.byCity)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 6)
                  .map(([c, n]) => `${c} ${n}`)
                  .join(' · ')}
              </p>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
