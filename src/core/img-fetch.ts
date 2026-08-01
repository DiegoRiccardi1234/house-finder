/**
 * Regole per scaricare le miniature dei portali, condivise da chi le usa: il proxy `/api/img`
 * del server e la cache locale (`core/thumbs.ts`). Stanno in un posto solo perché un'allowlist
 * duplicata è un'allowlist che prima o poi diverge.
 *
 * Le CDN dei portali rispondono 403 (o 400) a chi non sembra il loro sito: servono lo User-Agent
 * di un browser desktop e il Referer giusto per host.
 */

export const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Host CDN ammessi (anti-SSRF: solo questi, solo https). */
export const IMG_HOST_SUFFIXES = [
  '.sbito.it',
  '.subito.it',
  '.fbcdn.net',
  '.idealista.it',
  '.im-cdn.it',
  '.immobiliare.it',
];

export function isAllowedImageHost(host: string): boolean {
  return IMG_HOST_SUFFIXES.some((s) => host === s.slice(1) || host.endsWith(s));
}

export function imgRefererFor(host: string): string {
  if (host.endsWith('.fbcdn.net')) return 'https://www.facebook.com/';
  if (host.includes('sbito') || host.endsWith('.subito.it')) return 'https://www.subito.it/';
  if (host.endsWith('.idealista.it')) return 'https://www.idealista.it/';
  return 'https://www.immobiliare.it/';
}

export function imageHeaders(host: string): Record<string, string> {
  return {
    Referer: imgRefererFor(host),
    'User-Agent': DESKTOP_UA,
    Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
  };
}

/** Il `cdnBaseUrl` grezzo di Subito non è servibile (400): serve il `?rule=` delle card. */
export const SUBITO_IMG_RULE = process.env.SUBITO_IMG_RULE ?? 'large-fixed-card-1x-auto';

/**
 * Ripara gli URL immagine che i portali non servono così come li pubblicano.
 * Oggi solo Subito; applicarla anche in lettura ripara gli URL salvati prima del fix.
 */
export function normalizeImageUrl(url: string): string {
  try {
    const u = new URL(url);
    const isSubito = u.hostname.includes('sbito') || u.hostname.endsWith('.subito.it');
    if (!isSubito || u.searchParams.has('rule')) return url;
    u.searchParams.set('rule', SUBITO_IMG_RULE);
    return u.toString();
  } catch {
    return url; // non è un URL: lo lasciamo com'è, se ne accorgerà chi prova a scaricarlo
  }
}
