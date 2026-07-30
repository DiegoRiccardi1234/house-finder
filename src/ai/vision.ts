import OpenAI from 'openai';
import type { Listing } from '../core/types.js';
import { dedupKey } from '../core/state.js';
import { visionCandidates } from '../config/models.js';
import { pickHealthyModels } from './endpoint-health.js';

/**
 * Stadio Vision: descrive la foto di anteprima di un annuncio con un modello vision (OpenRouter).
 * La descrizione viene poi iniettata nel prompt di reasoning (`score.ts`) così il voto ne tiene conto.
 * È un plus: se fallisce (immagine non accessibile, modello giù) si prosegue senza.
 */

const DEFAULT_VISION_MODEL = 'google/gemma-4-26b-a4b-it:free';
const MAX_IMAGES = 30; // tetto per run (costo/tempo: ~4s/immagine sui free)
const CONCURRENCY = 3;

export function visionConfigured(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}

/** Modello vision sano dal pool (env override + VISION_POOL); fallback al default. */
async function resolveVisionModel(): Promise<string> {
  const ranked = await pickHealthyModels(visionCandidates());
  return ranked[0] ?? DEFAULT_VISION_MODEL;
}

function client(): OpenAI {
  return new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
    defaultHeaders: { 'X-Title': 'House Finder' },
    timeout: Number(process.env.AI_TIMEOUT_MS ?? 60_000),
    maxRetries: 1,
  });
}

const PROMPT =
  'Sei un assistente immobiliare. Descrivi in UNA frase concisa (max 25 parole), in italiano, cosa mostra ' +
  'questa foto di un annuncio in affitto: stato/ristrutturazione, luminosità, arredamento, qualità percepita. ' +
  'Solo la descrizione, niente preamboli.';

async function describeOne(url: string, model: string): Promise<string | null> {
  try {
    const res = await client().chat.completions.create({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url } },
          ],
        },
      ],
    });
    return res.choices[0]?.message?.content?.trim() || null;
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

  const model = await resolveVisionModel(); // risolto UNA volta per batch
  log(`[vision] descrivo ${withPhoto.length} foto — modello ${model}`);
  for (let i = 0; i < withPhoto.length; i += CONCURRENCY) {
    const chunk = withPhoto.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map((l) => describeOne(l.thumb as string, model).then((d) => ({ key: dedupKey(l), d }))),
    );
    for (const r of results) if (r.d) out.set(r.key, r.d);
    log(`[vision] ${Math.min(i + CONCURRENCY, withPhoto.length)}/${withPhoto.length} foto`);
  }
  return out;
}
