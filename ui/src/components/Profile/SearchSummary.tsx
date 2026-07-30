import type { SearchProfile } from '../../types';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card, CardHeader } from '../../ui/Card';
import { Kicker } from '../../ui/Kicker';

/**
 * `data/criteria.md` è markdown libero: chi lo scrive non segue uno schema.
 * Il parser è quindi volutamente tollerante e, quando non riconosce la struttura,
 * lo dichiara invece di mostrare conteggi inventati.
 */
export function parseZones(criteria: string): { keep: string[]; drop: string[]; parsed: boolean } {
  const keep: string[] = [];
  const drop: string[] = [];
  const split = (s: string) =>
    s
      .split(/[,;·]/)
      .map((x) => x.replace(/\((core|ok)\)/gi, '').trim())
      .filter((x) => x.length > 1 && x.length < 40);

  for (const m of criteria.matchAll(/TIENI:\s*([^\n]*(?:\n(?!\s*(?:SCARTA|NO-GO|NOTE|-\s*[A-Z]))[^\n]*)*)/gi)) {
    keep.push(...split(m[1]));
  }
  for (const m of criteria.matchAll(/SCARTA:\s*([^\n]*(?:\n(?!\s*(?:TIENI|NO-GO|NOTE|-\s*[A-Z]))[^\n]*)*)/gi)) {
    drop.push(...split(m[1]));
  }
  const uniq = (a: string[]) => Array.from(new Set(a));
  return { keep: uniq(keep), drop: uniq(drop), parsed: keep.length > 0 || drop.length > 0 };
}

function mustHaves(criteria: string): string[] {
  const m = criteria.match(/MUST-HAVE[^\n]*:?\s*\n((?:\s*-\s*[^\n]+\n?)+)/i);
  if (!m) return [];
  return m[1]
    .split('\n')
    .map((l) => l.replace(/^\s*-\s*/, '').trim())
    .filter(Boolean)
    // Via la spiegazione fra parentesi e la punteggiatura finale: nel chip serve l'etichetta.
    .map((l) => l.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/[.;]+\s*$/, '').trim())
    .filter(Boolean);
}

const CITY_LABEL: Record<string, string> = { torino: 'Torino', bari: 'Bari' };

export function SearchSummary({
  criteria,
  searches,
  onEdit,
}: {
  criteria: string;
  searches: SearchProfile[];
  onEdit: () => void;
}) {
  const zones = parseZones(criteria);
  const musts = mustHaves(criteria);
  const cities = Array.from(new Set(searches.map((s) => s.city)));

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
        <div className="p-4 text-sm text-muted">
          Nessun profilo di ricerca configurato. Aggiungine uno in <b>Config → Ricerche/zone</b>.
        </div>
      ) : (
        <div className="grid gap-4 p-4 md:grid-cols-3">
          <div>
            <Kicker as="div">città</Kicker>
            <p className="mt-1 text-lg text-ink">
              {cities.map((c) => CITY_LABEL[c] ?? c).join(' · ')}
            </p>
          </div>

          <div className="md:col-span-2">
            <Kicker as="div">budget per taglio</Kicker>
            <ul className="mt-1 space-y-0.5 text-sm text-ink-soft">
              {searches.map((s) => (
                <li key={s.id} className="flex justify-between gap-4 tabular-nums">
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
            {zones.parsed ? (
              <p className="mt-1 text-sm text-ink-soft">
                <b className="text-ok">{zones.keep.length}</b> quartieri in whitelist ·{' '}
                <b className="text-danger">{zones.drop.length}</b> esclusi
                {zones.keep.length > 0 && (
                  <span className="block text-xs text-faint">{zones.keep.slice(0, 8).join(' · ')}…</span>
                )}
              </p>
            ) : (
              <p className="mt-1 text-sm text-faint">
                Criteri in formato libero: non ci sono elenchi <code>TIENI:</code>/<code>SCARTA:</code>{' '}
                da contare. Va benissimo — l'AI legge comunque tutto il testo.
              </p>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
