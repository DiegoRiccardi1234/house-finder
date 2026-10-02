import type { EmailLinkResolver } from '../../core/types.js';

const ACTION = /unsubscribe|disiscriv|cancel|baja|login|accedi|registr|password|preferences|preferenze|settings|account|magic|privacy|contatt|contact|gestisci/i;
const cache = new Map<string, { url: string | null; expires: number }>();
const CACHE_LIMIT = 500;

export function isEmailAction(value: string): boolean {
  try { return ACTION.test(decodeURIComponent(value)); } catch { return ACTION.test(value); }
}

function safeUrl(href: string): URL | null {
  try {
    const url = new URL(href);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || isEmailAction(href)) return null;
    return url;
  } catch { return null; }
}

function canonical(url: URL, source: string): string | null {
  const domain = source === 'idealista' ? 'idealista.it' : source === 'immobiliare' ? 'immobiliare.it' : '';
  if (!domain || ![domain, `www.${domain}`].includes(url.hostname)) return null;
  const match = url.pathname.match(source === 'idealista' ? /^\/immobil[ie]\/(\d+)\/?$/ : /^\/annunci\/(\d+)\/?$/);
  if (!match) return null;
  return `https://www.${domain}/${source === 'idealista' ? 'immobile' : 'annunci'}/${match[1]}/`;
}

function tracking(url: URL, source: string): boolean {
  // Unico wrapper opaco verificato live. Altri host/path restano non risolti, senza richieste.
  return source === 'idealista' && url.hostname === 'l.settimanale.idealista.it' && /^\/rts\/[\w-]{1,512}\/?$/.test(url.pathname);
}

/** Sessione per run: massimo 120 HEAD, tre richieste concorrenti, tre hop, cinque secondi/hop. */
export function createEmailLinkResolver(options: { maxRequests?: number; timeoutMs?: number } = {}): EmailLinkResolver & {
  stats: { requests: number; cacheHits: number; exhausted: boolean };
} {
  const limit = Math.max(0, options.maxRequests ?? 120);
  const timeout = options.timeoutMs ?? 5000;
  const stats = { requests: 0, cacheHits: 0, exhausted: false };
  const pending = new Map<string, Promise<string | null>>();
  const waiting: Array<() => void> = [];
  let active = 0;

  async function head(url: URL): Promise<Response | null> {
    if (active >= 3) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      if (stats.requests >= limit) { stats.exhausted = true; return null; }
      stats.requests++;
      return await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(timeout) });
    } finally {
      const next = waiting.shift();
      if (next) next(); else active--;
    }
  }

  async function follow(href: string, source: string): Promise<string | null> {
    let url = safeUrl(href);
    if (!url) return null;
    for (let hop = 0; hop < 3; hop++) {
      const detail = canonical(url, source);
      if (detail) return detail; // Mai visitare il dettaglio, basta il Location canonico.
      if (!tracking(url, source)) return null;
      const response = await head(url);
      if (!response || response.status < 300 || response.status >= 400) return null;
      const location = response.headers.get('location');
      if (!location) return null;
      const next = safeUrl(new URL(location, url).href);
      if (!next) return null;
      const target = canonical(next, source);
      if (target) return target;
      url = next;
    }
    return null;
  }

  return {
    stats,
    async resolve(href, source) {
      const key = `${source}:${href}`;
      const cached = cache.get(key);
      if (cached && cached.expires > Date.now()) { stats.cacheHits++; return cached.url; }
      if (cached) cache.delete(key);
      const inflight = pending.get(key);
      if (inflight) return inflight;
      const attempt = (async () => {
        let url: string | null = null;
        try { url = await follow(href, source); } catch { /* URL e token non entrano nei log. */ }
        if (!stats.exhausted) {
          if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
          // I vecchi wrapper falliti non consumano tutto il budget nei run successivi.
          cache.set(key, { url, expires: Date.now() + (url ? 24 : 1) * 60 * 60 * 1000 });
        }
        return url;
      })();
      pending.set(key, attempt);
      return attempt;
    },
  };
}
