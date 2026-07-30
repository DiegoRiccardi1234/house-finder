import type { AiHealth } from '../../types';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card, CardHeader } from '../../ui/Card';
import { Kicker } from '../../ui/Kicker';

export function AiStatus({ health, onConfigure }: { health: AiHealth | null; onConfigure: () => void }) {
  if (!health) return <Card className="p-4 text-sm text-muted">Controllo lo stato dell'AI…</Card>;

  if (!health.configured) {
    return (
      <Card>
        <CardHeader kicker="valutazione" title="Nessun provider AI" />
        <div className="p-4">
          <p className="text-sm text-muted">
            {health.reason ?? 'Nessun provider configurato.'} Con una key gratuita (Groq, Cerebras,
            Google o OpenRouter) ogni annuncio riceve voto, pro, contro e un verdetto.
          </p>
          <Button variant="primary" size="sm" onClick={onConfigure} className="mt-3">
            Configura un provider
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        kicker="valutazione"
        title="Stato AI"
        action={
          <Button size="sm" variant="ghost" onClick={onConfigure}>
            Cambia provider
          </Button>
        }
      />
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent" mono>
            {health.provider}
          </Badge>
          <span className="text-sm text-ink">{health.model ?? '—'}</span>
          {health.probe === 'openrouter' ? (
            <span className="text-xs text-faint">salute degli endpoint pubblicata dal provider</span>
          ) : (
            <span className="text-xs text-faint">
              questo provider non pubblica lo stato: l'ordine segue preferenza e penalità osservate
            </span>
          )}
        </div>

        <div>
          <Kicker as="div">catena di failover</Kicker>
          <ol className="mt-1 space-y-1">
            {health.chain.map((s, i) => (
              <li key={`${s.provider}:${s.model}`} className="flex items-center gap-2 text-sm">
                <span className="w-4 shrink-0 text-right text-xs tabular-nums text-faint">{i + 1}</span>
                <span className="truncate font-mono text-[0.72rem] text-ink-soft">
                  {s.provider}/{s.model}
                </span>
                {s.uptime5m != null && (
                  <span className="shrink-0 text-xs tabular-nums text-muted">{s.uptime5m}%</span>
                )}
                {s.penalty > 0 && (
                  <Badge tone="warn" mono>
                    penalizzato
                  </Badge>
                )}
              </li>
            ))}
          </ol>
          {health.chain.length === 0 && (
            <p className="mt-1 text-sm text-muted">
              Nessun modello disponibile sul provider attivo. Controlla la key o scegline un altro.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
