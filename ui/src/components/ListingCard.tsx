import type { StoredListing, ListingStatus, ListingFields } from '../types';
import { ScoreBadge } from './ScoreBadge';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { Kicker } from '../ui/Kicker';
import { cx } from '../ui/cx';

function FieldChips({ f }: { f: ListingFields }) {
  return (
    <div className="flex flex-wrap gap-1">
      {f.arredato && (
        <Badge tone={f.arredato === 'no' ? 'danger' : 'ok'}>
          {f.arredato === 'no' ? 'Non arredato' : f.arredato === 'parziale' ? 'Parz. arredato' : 'Arredato'}
        </Badge>
      )}
      {f.classe_energetica && <Badge>Classe {f.classe_energetica}</Badge>}
      {f.piano && <Badge>Piano {f.piano}</Badge>}
      {f.ascensore != null && <Badge>{f.ascensore ? 'Ascensore' : 'No ascensore'}</Badge>}
      {f.tipo_contratto && <Badge>{f.tipo_contratto}</Badge>}
      {f.contatto && (
        <Badge tone={f.contatto === 'privato' ? 'ok' : 'neutral'}>
          {f.contatto === 'privato' ? 'Privato' : 'Agenzia'}
        </Badge>
      )}
      {f.vincoli_inquilino.slice(0, 3).map((v, i) => (
        <Badge key={i} tone="danger">
          {v}
        </Badge>
      ))}
    </div>
  );
}

/** Miniature Subito/FB sono hotlink-bloccate: passano dal proxy server (/api/img). Il resto diretto. */
function imgSrc(url: string): string {
  try {
    const h = new URL(url).hostname;
    const needsProxy = h.includes('sbito') || h.endsWith('.subito.it') || h.endsWith('.fbcdn.net');
    return needsProxy ? `/api/img?src=${encodeURIComponent(url)}` : url;
  } catch {
    return url;
  }
}

const CHANNEL_LABEL: Record<string, string> = {
  email: 'Email',
  immobiliare: 'Immobiliare',
  subito: 'Subito',
  idealista: 'Idealista',
  facebook: 'Facebook',
  'fb-group': 'FB gruppo',
  'fb-marketplace': 'FB market',
};

const STATUS_ACTIONS: { status: ListingStatus; label: string; on: string }[] = [
  { status: 'favorite', label: 'Preferito', on: 'bg-warn text-white' },
  { status: 'contacted', label: 'Contattato', on: 'bg-accent text-on-accent' },
  { status: 'dismissed', label: 'Scarta', on: 'bg-surface-hi text-muted border border-line' },
];

function meta(l: StoredListing['listing']): string {
  const parts: string[] = [];
  if (l.price != null) parts.push(`€${l.price}/mese`);
  if (l.sizeSqm != null) parts.push(`${l.sizeSqm} m²`);
  if (l.rooms != null) parts.push(`${l.rooms} loc.`);
  if (l.zone) parts.push(l.zone);
  return parts.join(' · ');
}

export function ListingCard({
  rec,
  onStatus,
}: {
  rec: StoredListing;
  onStatus: (key: string, status: ListingStatus) => void;
}) {
  const l = rec.listing;
  const dimmed = rec.status === 'dismissed';
  const thumb = rec.photos[0] ?? l.thumb ?? null;

  return (
    <Card
      interactive={!dimmed}
      className={cx('flex flex-col overflow-hidden', dimmed && 'opacity-55')}
    >
      <div className="relative h-40 bg-surface-3">
        {thumb ? (
          <img
            src={imgSrc(thumb)}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Kicker tone="muted">senza foto</Kicker>
          </div>
        )}
        <span className="absolute left-2 top-2">
          <Badge mono tone="neutral" className="bg-surface-hi/90 backdrop-blur">
            {CHANNEL_LABEL[rec.channel] ?? rec.channel}
          </Badge>
        </span>
        {rec.status !== 'new' && rec.status !== 'dismissed' && (
          <span className="absolute right-2 top-2">
            <Badge mono tone={rec.status === 'favorite' ? 'warn' : 'accent'} className="bg-surface-hi/90 backdrop-blur">
              {rec.status === 'favorite' ? 'preferito' : 'contattato'}
            </Badge>
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start gap-2">
          <a
            href={l.url}
            target="_blank"
            rel="noreferrer"
            className="line-clamp-2 flex-1 text-base leading-snug text-ink hover:text-accent hover:underline"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {l.title}
          </a>
          <ScoreBadge ai={rec.ai} />
        </div>

        <p className="text-sm tabular-nums text-muted">{meta(l)}</p>

        {rec.fields && <FieldChips f={rec.fields} />}

        {rec.ai && (
          <>
            <p className="text-sm italic text-ink-soft">“{rec.ai.verdict}”</p>
            {(rec.ai.pros.length > 0 || rec.ai.cons.length > 0) && (
              <div className="flex flex-wrap gap-1">
                {rec.ai.pros.slice(0, 3).map((p, i) => (
                  <Badge key={`p${i}`} tone="ok">
                    + {p}
                  </Badge>
                ))}
                {rec.ai.cons.slice(0, 3).map((c, i) => (
                  <Badge key={`c${i}`} tone="danger">
                    − {c}
                  </Badge>
                ))}
              </div>
            )}
          </>
        )}

        {rec.visionSummary && (
          <p className="text-xs text-faint">
            <Kicker>foto</Kicker> {rec.visionSummary}
          </p>
        )}

        <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
          {STATUS_ACTIONS.map((a) => {
            const active = rec.status === a.status;
            return (
              <button
                key={a.status}
                aria-pressed={active}
                onClick={() => onStatus(rec.key, active ? 'new' : a.status)}
                className={cx(
                  'rounded-[var(--radius-btn)] px-2.5 py-1 font-mono text-[0.62rem] uppercase tracking-[0.08em] transition-colors duration-150',
                  active ? a.on : 'bg-surface-3 text-muted hover:bg-surface-hi hover:text-ink',
                )}
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {a.label}
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
