import type { Listing } from '../core/types.js';
import { dedupKey } from '../core/state.js';
import { readThumbDataUri } from '../core/thumbs.js';
import { buildChainForTask } from './failover.js';
import { configuredProviders } from './credentials.js';
import { getProvider } from './providers/registry.js';
import type { ModelRef } from './providers/types.js';

/**
 * Stadio Vision: descrive la foto di anteprima di un annuncio con un modello vision.
 * La descrizione viene poi iniettata nel prompt di reasoning (`score.ts`) così il voto ne tiene conto.
 * È un plus: se fallisce (immagine non accessibile, modello giù) si prosegue senza.
 *
 * Le miniature di Subito e Facebook sono hotlink-bloccate: un provider a cui passi l'URL grezzo
 * riceve un 400/403 e non descrive niente. Per questo la pipeline copia prima le foto in locale
 * (`core/thumbs.ts`) e qui le mandiamo come **data URI base64** — l'unico modo che funziona su
 * tutti i provider senza esporre un endpoint pubblico.
 */

const MAX_IMAGES = 30; // tetto per run (costo/tempo: ~4s/immagine sui free)
const CONCURRENCY = 3;

export function visionConfigured(): boolean {
  return configuredProviders().length > 0;
}

const PROMPT =
  'Sei un assistente immobiliare. Descrivi in UNA frase concisa (max 25 parole), in italiano, cosa mostra ' +
  'questa foto di un annuncio in affitto: stato/ristrutturazione, luminosità, arredamento, qualità percepita. ' +
  'Solo la descrizione, niente preamboli.';

async function describeOne(url: string, ref: ModelRef): Promise<string | null> {
  try {
    const reply = await getProvider(ref.provider).chat({
      model: ref.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image', url },
          ],
        },
      ],
    });
    return reply.text.trim() || null;
  } catch {
    return null; // immagine non raggiungibile / modello giù → nessuna descrizione
  }
}

/**
 * Cosa mandare al provider: la copia locale in base64 se c'è, altrimenti l'URL remoto.
 * Il fallback serve agli annunci le cui foto non siamo riusciti a scaricare (Immobiliare e
 * Idealista non bloccano l'hotlink, quindi lì l'URL funziona ancora).
 */
async function imageSourceFor(l: Listing, cached: Map<string, string>): Promise<string | null> {
  const local = cached.get(dedupKey(l));
  if (local) {
    const dataUri = await readThumbDataUri(local);
    if (dataUri) return dataUri;
  }
  return l.thumb ?? null;
}

/**
 * Descrive le foto degli annunci che ne hanno una. Ritorna mappa dedupKey → descrizione.
 * Concorrenza limitata + tetto immagini per non saturare i free tier.
 *
 * `cached` = dedupKey → `/thumbs/…` prodotta dalla pipeline (vedi `core/thumbs.ts`).
 */
export async function describePhotos(
  listings: Listing[],
  log: (m: string) => void = () => {},
  cached: Map<string, string> = new Map(),
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!visionConfigured()) return out;

  const withPhoto = listings.filter((l) => l.thumb || cached.has(dedupKey(l))).slice(0, MAX_IMAGES);
  if (!withPhoto.length) return out;

  const chain = await buildChainForTask('vision');
  const ref = chain[0];
  if (!ref) {
    log('[vision] nessun modello vision disponibile sui provider configurati — salto');
    return out;
  }
  log(`[vision] descrivo ${withPhoto.length} foto — modello ${ref.provider}/${ref.model}`);
  for (let i = 0; i < withPhoto.length; i += CONCURRENCY) {
    const chunk = withPhoto.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (l) => {
        const src = await imageSourceFor(l, cached);
        const d = src ? await describeOne(src, ref) : null;
        return { key: dedupKey(l), d };
      }),
    );
    for (const r of results) if (r.d) out.set(r.key, r.d);
    log(`[vision] ${Math.min(i + CONCURRENCY, withPhoto.length)}/${withPhoto.length} foto`);
  }
  return out;
}
