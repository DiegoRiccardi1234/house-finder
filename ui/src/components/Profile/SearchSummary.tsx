import type { Profile } from '../../types';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card, CardHeader } from '../../ui/Card';
import { Kicker } from '../../ui/Kicker';
import { useCities } from '../CityPicker';

/**
 * Il riassunto di cosa cerchi.
 *
 * Leggeva il markdown **generato** e lo ri-parsava con delle regex per contare quartieri e
 * irrinunciabili: un giro struttura → testo → espressioni regolari, con due viste della stessa
 * cosa che potevano divergere. E divergevano: qui comparivano "29 quartieri in whitelist" mentre
 * il profilo ne conteneva 15, perché il parser di questa card non sapeva attribuirli alle città.
 *
 * Ora legge la stessa fonte che modifica l'editor. Un dato, un posto.
 */
export function SearchSummary({
  profile,
  onEdit,
}: {
  profile: Profile | null;
  onEdit: () => void;
}) {
  const cities = useCities();
  const label = (slug: string): string => cities.find((c) => c.slug === slug)?.label ?? slug;

  const searches = profile?.searches ?? [];
  const zones = profile?.zones ?? [];
  const musts = profile?.musts ?? [];
  const keep = zones.flatMap((z) => z.keep);
  const avoid = zones.flatMap((z) => z.avoid);
  const citta = Array.from(new Set(searches.map((s) => s.city)));

  return (
    <Card>
      <CardHeader
        kicker="il tuo profilo"
        title="La tua ricerca"
        action={
          <Button size="sm" variant="ghost" onClick={onEdit}>
            Modifica
          </Button>
        }
      />

      {searches.length === 0 ? (
        <div className="flex flex-wrap items-center gap-3 p-4 text-sm text-muted">
          Non hai ancora detto cosa cerchi.
          <Button size="sm" variant="primary" onClick={onEdit}>
            Dillo ora
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 p-4 md:grid-cols-3">
          <div>
            <Kicker as="div">città</Kicker>
            <p className="mt-1 text-lg text-ink">{citta.map(label).join(' · ')}</p>
          </div>

          <div className="md:col-span-2">
            <Kicker as="div">cosa cerchi</Kicker>
            <ul className="mt-1 space-y-0.5 text-sm text-ink-soft">
              {searches.map((s, i) => (
                <li key={s.id || i} className="flex justify-between gap-4 tabular-nums">
                  <span className="truncate">{s.label}</span>
                  <span className="shrink-0 font-semibold">≤ {s.maxPrice} €</span>
                </li>
              ))}
            </ul>
          </div>

          {musts.length > 0 && (
            <div className="md:col-span-3">
              <Kicker as="div">irrinunciabili</Kicker>
              <div className="mt-1 flex flex-wrap gap-1">
                {musts.map((m, i) => (
                  <Badge key={i} tone="accent">
                    {m}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div className="md:col-span-3">
            <Kicker as="div">zone</Kicker>
            {keep.length + avoid.length === 0 ? (
              <p className="mt-1 text-sm text-faint">
                Nessun quartiere scelto: la zona non filtra, conta tutto il resto.
              </p>
            ) : (
              <p className="mt-1 text-sm text-ink-soft">
                <b className="text-ok">{keep.length}</b> da tenere ·{' '}
                <b className="text-danger">{avoid.length}</b> da scartare
                {keep.length > 0 && (
                  <span className="block text-xs text-faint">
                    {keep.slice(0, 8).join(' · ')}
                    {keep.length > 8 ? '…' : ''}
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
