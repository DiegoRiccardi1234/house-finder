import type { StoredListing, ListingStatus, ListingFields } from '../types';
import { ScoreBadge } from './ScoreBadge';

const chip = 'rounded px-1.5 py-0.5 text-xs';
const neutral = `${chip} bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300`;
const good = `${chip} bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200`;
const bad = `${chip} bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200`;

function FieldChips({ f }: { f: ListingFields }) {
  return (
    <div className="flex flex-wrap gap-1">
      {f.arredato && <span className={f.arredato === 'no' ? bad : good}>{f.arredato === 'no' ? 'Non arredato' : f.arredato === 'parziale' ? 'Parz. arredato' : 'Arredato'}</span>}
      {f.classe_energetica && <span className={neutral}>Classe {f.classe_energetica}</span>}
      {f.piano && <span className={neutral}>Piano {f.piano}</span>}
      {f.ascensore != null && <span className={neutral}>{f.ascensore ? 'Ascensore' : 'No ascensore'}</span>}
      {f.tipo_contratto && <span className={neutral}>{f.tipo_contratto}</span>}
      {f.contatto && <span className={f.contatto === 'privato' ? good : neutral}>{f.contatto === 'privato' ? 'Privato' : 'Agenzia'}</span>}
      {f.vincoli_inquilino.slice(0, 3).map((v, i) => (
        <span key={i} className={bad}>{v}</span>
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
};

const STATUS_ACTIONS: { status: ListingStatus; label: string; cls: string }[] = [
  { status: 'favorite', label: '★ Preferito', cls: 'bg-amber-500/90 hover:bg-amber-500 text-white' },
  { status: 'contacted', label: '✓ Contattato', cls: 'bg-sky-600/90 hover:bg-sky-600 text-white' },
  { status: 'dismissed', label: '✕ Scarta', cls: 'bg-stone-500/80 hover:bg-stone-500 text-white' },
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
    <div
      className={`flex flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition dark:border-stone-800 dark:bg-stone-900 ${
        dimmed ? 'opacity-50' : 'hover:shadow-md'
      }`}
    >
      <div className="relative h-40 bg-stone-100 dark:bg-stone-800">
        {thumb ? (
          <img src={imgSrc(thumb)} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <div className="flex h-full items-center justify-center text-4xl text-stone-300 dark:text-stone-700">🏠</div>
        )}
        <span className="absolute left-2 top-2 rounded-md bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
          {CHANNEL_LABEL[rec.channel] ?? rec.channel}
        </span>
        {rec.status !== 'new' && rec.status !== 'dismissed' && (
          <span className="absolute right-2 top-2 rounded-md bg-white/90 px-2 py-0.5 text-xs font-semibold text-stone-800">
            {rec.status === 'favorite' ? '★ Preferito' : '✓ Contattato'}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start gap-2">
          <a
            href={l.url}
            target="_blank"
            rel="noreferrer"
            className="line-clamp-2 flex-1 font-semibold leading-snug text-stone-900 hover:text-teal-700 hover:underline dark:text-stone-100 dark:hover:text-teal-400"
          >
            {l.title}
          </a>
          <ScoreBadge ai={rec.ai} />
        </div>

        <p className="text-sm text-stone-500 dark:text-stone-400">{meta(l)}</p>

        {rec.fields && <FieldChips f={rec.fields} />}

        {rec.ai && (
          <>
            <p className="text-sm italic text-stone-700 dark:text-stone-300">“{rec.ai.verdict}”</p>
            {(rec.ai.pros.length > 0 || rec.ai.cons.length > 0) && (
              <div className="flex flex-wrap gap-1 text-xs">
                {rec.ai.pros.slice(0, 3).map((p, i) => (
                  <span key={`p${i}`} className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
                    + {p}
                  </span>
                ))}
                {rec.ai.cons.slice(0, 3).map((c, i) => (
                  <span key={`c${i}`} className="rounded bg-rose-100 px-2 py-0.5 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200">
                    − {c}
                  </span>
                ))}
              </div>
            )}
          </>
        )}

        {rec.visionSummary && (
          <p className="text-xs text-stone-500 dark:text-stone-400">📷 {rec.visionSummary}</p>
        )}

        <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
          {STATUS_ACTIONS.map((a) => (
            <button
              key={a.status}
              onClick={() => onStatus(rec.key, rec.status === a.status ? 'new' : a.status)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                rec.status === a.status ? a.cls : 'bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
