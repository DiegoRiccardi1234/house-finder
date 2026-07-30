import type { Listing } from '../core/types.js';
import { dedupKey } from '../core/state.js';
import { buildChainForTask } from './failover.js';
import { configuredProviders } from './credentials.js';
import { getProvider } from './providers/registry.js';
import type { ModelRef } from './providers/types.js';

/**
 * Stadio Vision: descrive la foto di anteprima di un annuncio con un modello vision.
 * La descrizione viene poi iniettata nel prompt di reasoning (`score.ts`) così il voto ne tiene conto.
 * È un plus: se fallisce (immagine non accessibile, modello giù) si prosegue senza.
 *
 * NOTA nota: le miniature di Subito e Facebook sono hotlink-bloccate — è il motivo per cui
 * esiste il proxy `/api/img`. Passando l'URL grezzo al provider, quelle immagini falliscono
 * qualunque provider si usi. È un limite preesistente, non introdotto dal multi-provider.
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
 * Descrive le foto degli annunci che ne hanno una. Ritorna mappa dedupKey → descrizione.
 * Concorrenza limitata + tetto immagini per non saturare i free tier.
 */
export async function describePhotos(listings: Listing[], log: (m: string) => void = () => {}): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!visionConfigured()) return out;

  const withPhoto = listings.filter((l) => l.thumb).slice(0, MAX_IMAGES);
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
      chunk.map((l) => describeOne(l.thumb as string, ref).then((d) => ({ key: dedupKey(l), d }))),
    );
    for (const r of results) if (r.d) out.set(r.key, r.d);
    log(`[vision] ${Math.min(i + CONCURRENCY, withPhoto.length)}/${withPhoto.length} foto`);
  }
  return out;
}
