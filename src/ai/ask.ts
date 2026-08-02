import type { z } from 'zod';
import { buildChainForTask } from './failover.js';
import { getProvider } from './providers/registry.js';
import { recordPenalty } from './endpoint-health.js';
import { refKey } from './providers/types.js';
import { extractJson } from './score.js';
import { configuredProviders } from './credentials.js';

/**
 * Una domanda secca a un modello, con risposta in JSON.
 *
 * Lo scoring manda gruppi di dieci annunci e ha una sua macchina; qui serve l'opposto: una
 * domanda, una risposta, e la possibilità di rinunciare senza rompere niente. È lo stesso
 * schema di `src/ai/vision.ts`, che descrive una foto e torna `null` quando non ce la fa.
 *
 * Serve a due cose che prima l'utente doveva fare a mano: capire una frase come *"bilocale
 * arredato a Torino sotto 700"* e proporre i quartieri di una città.
 *
 * **Non solleva.** Torna `null` se manca un provider, se la catena si esaurisce o se il JSON non
 * si lascia leggere: chi chiama sta offrendo un aiuto, non eseguendo un passo obbligatorio, e un
 * suggerimento che non arriva deve lasciare l'utente esattamente dov'era.
 */

export interface AskOptions {
  /** Quanti modelli provare prima di rinunciare. Oltre il terzo, di solito, non è la catena. */
  maxTentativi?: number;
  maxTokens?: number;
}

export function aiDisponibile(): boolean {
  return configuredProviders().length > 0;
}

export async function ask<T>(
  system: string,
  user: string,
  schema: z.ZodType<T>,
  opts: AskOptions = {},
): Promise<T | null> {
  if (!aiDisponibile()) return null;

  const chain = await buildChainForTask('reasoning');
  const tentativi = Math.min(opts.maxTentativi ?? 3, chain.length);

  for (let i = 0; i < tentativi; i++) {
    const ref = chain[i];
    if (!ref) break;
    try {
      const reply = await getProvider(ref.provider).chat({
        model: ref.model,
        json: true,
        maxTokens: opts.maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      });
      const parsed = schema.safeParse(extractJson(reply.text));
      if (parsed.success) return parsed.data;
      // JSON valido ma di forma sbagliata: è lo stesso difetto del troncamento visto da qui, e
      // insistere sullo stesso modello lo ripeterebbe. Si penalizza e si passa al successivo.
      recordPenalty(refKey(ref), 'malformed');
    } catch {
      // Il provider tipizza già troncamento, vuoto e 429; qui interessa solo passare oltre.
      recordPenalty(refKey(ref), 'json_fail');
    }
  }
  return null;
}
