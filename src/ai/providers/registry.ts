import { createAnthropicProvider } from './anthropic.js';
import { createCompatProvider } from './openai-compat.js';
import { specOf } from './catalog.js';
import type { Provider, ProviderId } from './types.js';
import { endpointFor, keyFor } from '../credentials.js';

const cache = new Map<ProviderId, Provider>();

export function getProvider(id: ProviderId): Provider {
  const hit = cache.get(id);
  if (hit) return hit;
  const spec = specOf(id);
  const p =
    id === 'anthropic'
      ? createAnthropicProvider({ baseURL: endpointFor(id), apiKey: keyFor(id), caps: spec.caps })
      : createCompatProvider({
          id,
          baseURL: endpointFor(id),
          apiKey: keyFor(id),
          caps: spec.caps,
          headers: id === 'openrouter' ? { 'HTTP-Referer': 'https://github.com/DiegoRiccardi1234/house-finder' } : undefined,
        });
  cache.set(id, p);
  return p;
}

/**
 * Da chiamare dopo ogni scrittura di credenziali: senza, l'utente salva una key dalla UI
 * e il server continua a usare il client costruito con quella vecchia.
 */
export function invalidateRegistry(): void {
  cache.clear();
}
