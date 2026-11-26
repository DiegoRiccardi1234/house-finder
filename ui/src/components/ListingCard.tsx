import { useState } from 'react';
import type { StoredListing, ListingStatus, ListingFields, Tenant } from '../types';
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
  if (url.startsWith('/')) return url; // copia locale servita da noi (/thumbs/…)
  try {
    const h = new URL(url).hostname;
    const needsProxy = h.includes('sbito') || h.endsWith('.subito.it') || h.endsWith('.fbcdn.net');
    return needsProxy ? `/api/img?src=${encodeURIComponent(url)}` : url;
  } catch {
    return url;
  }
}

/**
 * Sorgenti da provare in ordine: prima la copia locale, poi l'URL remoto dell'annuncio.
 * Gli URL Facebook scadono in pochi giorni e quelli Subito salvati prima del fix danno 400:
 * senza fallback esplicito il browser mostrerebbe un riquadro rotto invece del placeholder.
 */
function photoSources(rec: StoredListing): string[] {
  const raw = [rec.photos[0], rec.listing.thumb].filter((v): v is string => !!v);
  return [...new Set(raw)].map(imgSrc);
}

function Thumb({ rec }: { rec: StoredListing }) {
  const sources = photoSources(rec);
  const [attempt, setAttempt] = useState(0);
  const src = sources[attempt];

  if (!src) {
    return (
      <div className="flex h-full items-center justify-center">
        <Kicker tone="muted">senza foto</Kicker>
      </div>
    );
  }
  return (
    <img
      key={src}
      src={src}
      alt=""
      className="h-full w-full object-cover"
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setAttempt((n) => n + 1)}
    />
  );
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

function meta(rec: StoredListing): string {
  const l = rec.listing;
  const f = rec.fields;
  const price = l.price ?? f?.prezzo ?? null;
  const sqm = l.sizeSqm ?? f?.m2 ?? null;
  const rooms = f?.locali ?? l.rooms ?? null;
  const parts: string[] = [];
  if (price != null) parts.push(`€${price}/mese`);
  if (sqm != null) parts.push(`${sqm} m²`);
  if (rooms != null) parts.push(rooms === 1 ? 'monolocale' : rooms === 2 ? 'bilocale' : `${rooms} locali`);
  const zone = l.zone ?? f?.zona;
  if (zone) parts.push(zone);
  return parts.join(' · ');
}

const km = (n: number): string => `${n.toLocaleString('it-IT', { maximumFractionDigits: 1 })} km`;

/** Il messaggio da mandare a chi affitta, scritto dal profilo e senza AI: lo copi e lo mandi tu. */
export function askMessage(rec: StoredListing, tenant?: Tenant | null): string {
  const chi = tenant?.occupazione === 'lavoratore'
    ? 'Lavoro a tempo pieno (non sono uno studente)'
    : tenant?.occupazione === 'studente'
      ? 'Sono uno studente'
      : 'Cerco casa per me';
  const motivo = rec.askOwner?.reason ? ` Ho letto «${rec.askOwner.reason}»:` : '';
  return [
    `Buongiorno, le scrivo per l'annuncio «${rec.listing.title.slice(0, 90)}».`,
    `${chi} e la casa fa al caso mio.${motivo ? `${motivo} sarebbe` : ' Sarebbe'} disponibile ad affittarla anche a me?`,
    'Posso mandarle referenze e documenti. Grazie!',
    rec.listing.url,
  ].join('\n');
}

function AskOwner({ rec, tenant }: { rec: StoredListing; tenant?: Tenant | null }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-[var(--radius-btn)] border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
      <p className="text-ink">
        <b>Da chiedere:</b> {rec.askOwner?.reason}. La casa merita: chiedi se affittano anche a te.
      </p>
      <button
        type="button"
        className="mt-1 text-xs font-medium text-accent underline-offset-2 hover:underline"
        onClick={() => {
          void navigator.clipboard.writeText(askMessage(rec, tenant)).then(() => setCopied(true)).catch(() => setCopied(false));
        }}
      >
        {copied ? 'Messaggio copiato' : 'Copia il messaggio'}
      </button>
    </div>
  );
}

export function ListingCard({
  rec,
  onStatus,
  statusDisabled = false,
  refLabel,
  tenant,
}: {
  rec: StoredListing;
  onStatus: (key: string, status: ListingStatus) => void;
  statusDisabled?: boolean;
  /** Nome del punto di riferimento della città ("lavoro"), per dire da dove si misura. */
  refLabel?: string;
  tenant?: Tenant | null;
}) {
  const l = rec.listing;
  const dimmed = rec.status === 'dismissed';

  return (
    <Card
      interactive={!dimmed}
      className={cx('flex flex-col overflow-hidden', dimmed && 'opacity-55')}
    >
      <div className="relative h-40 bg-surface-3">
        <Thumb rec={rec} />
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

        <p className="text-sm tabular-nums text-muted">{meta(rec)}</p>
        {rec.distanceKm != null ? (
          <p className="text-sm text-ink-soft">
            {km(rec.distanceKm)} {refLabel ? `da ${refLabel.toLowerCase()}` : 'dal riferimento'}
            <span className="text-faint"> · in linea d'aria{rec.geo?.precision === 'zone' ? ', posizione approssimata' : ''}</span>
          </p>
        ) : refLabel ? (
          <p className="text-xs text-faint">Posizione da verificare: l'annuncio non dice la via.</p>
        ) : null}

        {rec.auto && (
          <p className="text-sm text-muted">
            <b className="font-medium text-ink-soft">Scartato in automatico:</b> {rec.auto.reason}.
          </p>
        )}
        {rec.askOwner && rec.status !== 'dismissed' && <AskOwner rec={rec} tenant={tenant} />}

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

        {rec.alsoIn && rec.alsoIn.length > 0 && (
          <p className="text-xs text-faint">
            Pubblicato anche in{' '}
            {rec.alsoIn.map((u, i) => (
              <a key={u} href={u} target="_blank" rel="noreferrer" className="underline hover:text-accent">
                {i === 0 ? '' : ', '}altro gruppo {i + 1}
              </a>
            ))}
          </p>
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
                disabled={statusDisabled}
                title={statusDisabled ? 'Attendi la fine della scansione per cambiare lo stato.' : undefined}
                onClick={() => onStatus(rec.key, active ? 'new' : a.status)}
                className={cx(
                  'rounded-[var(--radius-btn)] px-2.5 py-1 font-mono text-[0.62rem] uppercase tracking-[0.08em] transition-colors duration-150 disabled:cursor-wait disabled:opacity-50',
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
