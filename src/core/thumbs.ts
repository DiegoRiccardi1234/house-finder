import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { imageHeaders, isAllowedImageHost, normalizeImageUrl } from './img-fetch.js';

/**
 * Cache locale delle miniature.
 *
 * Perché esiste: gli URL delle foto Facebook sono firmati e **scadono in pochi giorni**
 * (`oh`/`oe` nella query), quelli di Subito rispondono 400 senza il `?rule=`, e tutti e due
 * sono hotlink-bloccati. Tenere in archivio l'URL remoto significa avere card senza foto una
 * settimana dopo lo scraping. Qui il file viene copiato una volta sola sul disco, sotto
 * `state/` (gitignorato come l'archivio), e l'archivio punta a `/thumbs/<hash>.<ext>`.
 *
 * Regola di fondo: la foto è un plus. Nessuna funzione qui solleva: al massimo ritorna `null`
 * e chi chiama tiene l'URL remoto o mostra il placeholder.
 */

export const THUMBS_DIR = process.env.THUMBS_DIR ?? join('state', 'thumbs');
export const THUMB_URL_PREFIX = '/thumbs/';

const MAX_BYTES = 2 * 1024 * 1024; // una miniatura di portale pesa 10-60 KB: oltre 2 MB non è una miniatura
const TIMEOUT_MS = Number(process.env.THUMB_TIMEOUT_MS ?? 15_000);

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/gif': '.gif',
};
const TYPE_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
};
const EXTS = Object.keys(TYPE_BY_EXT);

/**
 * Identità dell'immagine ai fini della cache.
 *
 * Su Facebook la query contiene la firma (`oh`, `oe`, `_nc_gid`) che cambia a ogni scrape:
 * includerla vorrebbe dire ri-scaricare tutto ogni run e riempire il disco di duplicati.
 * Altrove la query È parte dell'immagine (su Subito `?rule=` decide la dimensione servita).
 */
export function cacheKey(url: string): string {
  let basis = url;
  try {
    const u = new URL(url);
    basis = u.hostname.endsWith('.fbcdn.net') ? u.origin + u.pathname : u.toString();
  } catch {
    /* non è un URL: hash del testo grezzo, tanto poi il download fallirà */
  }
  return createHash('sha1').update(basis).digest('hex');
}

/** True se il valore è già un percorso servito da noi (`/thumbs/…`) e non un URL remoto. */
export function isCachedThumb(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.startsWith(THUMB_URL_PREFIX);
}

/** Percorso su disco di una miniatura in cache. `null` se il valore non è un `/thumbs/…` pulito. */
export function thumbFilePath(publicPath: string): string | null {
  if (!isCachedThumb(publicPath)) return null;
  const name = basename(publicPath.slice(THUMB_URL_PREFIX.length)); // niente `..`, niente sottocartelle
  if (!name || !EXTS.some((e) => name.endsWith(e))) return null;
  return join(THUMBS_DIR, name);
}

/**
 * Content-Type di una miniatura in cache. Serve perché la tabella MIME di Express 4 (`send`)
 * si ferma al 2017 e non conosce `.avif`: senza questo, le foto Idealista (che arrivano tutte
 * in avif) verrebbero servite come `application/octet-stream`.
 */
export function thumbContentType(file: string): string | null {
  const ext = EXTS.find((e) => file.toLowerCase().endsWith(e));
  return ext ? TYPE_BY_EXT[ext] : null;
}

function findCached(hash: string): string | null {
  for (const ext of EXTS) {
    if (existsSync(join(THUMBS_DIR, hash + ext))) return hash + ext;
  }
  return null;
}

/**
 * Scarica la miniatura (se non è già in cache) e ritorna il percorso pubblico `/thumbs/<file>`.
 * `null` = non ce l'abbiamo fatta: host non ammesso, HTTP non-2xx, tipo sconosciuto, timeout.
 */
export async function cacheThumb(rawUrl: string | null | undefined): Promise<string | null> {
  if (!rawUrl) return null;
  if (isCachedThumb(rawUrl)) return existsSync(thumbFilePath(rawUrl) ?? '') ? rawUrl : null;

  const url = normalizeImageUrl(rawUrl);
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !isAllowedImageHost(u.hostname)) return null;

  const hash = cacheKey(url);
  const hit = findCached(hash);
  if (hit) return THUMB_URL_PREFIX + hit;

  try {
    const res = await fetch(u.toString(), {
      headers: imageHeaders(u.hostname),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const ext = EXT_BY_TYPE[type];
    if (!ext) return null; // HTML di errore travestito da immagine, o formato che non sappiamo servire
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_BYTES) return null;

    const file = hash + ext;
    await mkdir(THUMBS_DIR, { recursive: true });
    // tmp + rename: un crash a metà download non lascia un file troncato in cache.
    const tmp = join(THUMBS_DIR, `${file}.tmp`);
    await writeFile(tmp, buf);
    await rename(tmp, join(THUMBS_DIR, file));
    return THUMB_URL_PREFIX + file;
  } catch {
    return null; // rete giù, timeout, disco pieno: la foto resta remota
  }
}

/** Esegue `fn` su ogni elemento con al massimo `limit` chiamate in volo. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Scarica in parallelo (limitato) una lista di URL. Ritorna mappa urlOriginale → `/thumbs/…`. */
export async function cacheThumbs(urls: string[], concurrency = 4): Promise<Map<string, string>> {
  const unique = [...new Set(urls.filter(Boolean))];
  const out = new Map<string, string>();
  const paths = await mapLimit(unique, concurrency, cacheThumb);
  unique.forEach((url, i) => {
    const p = paths[i];
    if (p) out.set(url, p);
  });
  return out;
}

/** Legge una miniatura in cache come data URI (per i provider vision). `null` se manca. */
export async function readThumbDataUri(publicPath: string): Promise<string | null> {
  const file = thumbFilePath(publicPath);
  if (!file) return null;
  try {
    const buf = await readFile(file);
    if (!buf.length || buf.length > MAX_BYTES) return null;
    const ext = EXTS.find((e) => file.endsWith(e)) ?? '.jpg';
    return `data:${TYPE_BY_EXT[ext]};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Cancella le miniature non più referenziate (annunci potati, foto sostituite).
 * `keep` = i valori `/thumbs/…` ancora presenti in archivio. Ritorna quanti file ha tolto.
 */
export async function pruneThumbs(keep: Iterable<string>): Promise<number> {
  const wanted = new Set<string>();
  for (const k of keep) {
    if (isCachedThumb(k)) wanted.add(basename(k));
  }
  // Nessun riferimento: quasi certamente non è l'archivio vero (dataset demo, store di test).
  // Meglio rinunciare a recuperare spazio che svuotare la cache di un altro archivio.
  if (!wanted.size) return 0;
  let removed = 0;
  let files: string[];
  try {
    files = await readdir(THUMBS_DIR);
  } catch {
    return 0; // cartella mai creata: niente da potare
  }
  for (const f of files) {
    if (wanted.has(f)) continue;
    try {
      await unlink(join(THUMBS_DIR, f));
      removed++;
    } catch {
      /* file già sparito o in uso: non è un errore che valga il run */
    }
  }
  return removed;
}
