import express, { type Express, type Request, type Response } from 'express';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ListingStore, StoredListing } from '../core/store.js';
import { writeFileAtomic } from '../core/atomic.js';
import { runPipeline as realRunPipeline, type ChannelId, type LogFn, type RunSummary } from '../core/pipeline.js';
import { configured as aiConfigured } from '../ai/score.js';
import { isResidential } from '../core/match.js';
import { looksLikeListing, isShortTerm } from '../sources/fb-parse.js';
import { FB_STATE_PATH } from '../config/facebook.js';
import { configReadPath, localConfigPath } from '../config/paths.js';
import { chromium } from 'playwright';
import { createAiRouter } from './aiRoutes.js';
import { primaryProvider } from '../ai/credentials.js';
import { buildStats } from './stats.js';
import { RunManager, RunBusyError } from './runManager.js';
import { SearchesSchema, FbConfigSchema, StatusSchema, RunBodySchema } from './schemas.js';

type RunPipelineFn = (
  channels: ChannelId[],
  opts: { store: ListingStore; log?: LogFn; score?: boolean },
) => Promise<RunSummary>;

export interface AppDeps {
  store: ListingStore;
  /** Override per i test (default: la pipeline reale). */
  runPipeline?: RunPipelineFn;
  /** Override per i test (default: i file reali sotto `data/`). */
  configPaths?: { criteria: string; searches: string; facebook: string };
}

type ConfigKey = 'criteria' | 'searches' | 'facebook';
const CONFIG_FILES: Record<ConfigKey, string> = {
  criteria: 'criteria.md',
  searches: 'searches.json',
  facebook: 'facebook.json',
};

const UI_DIST = fileURLToPath(new URL('../../ui/dist', import.meta.url));

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Host CDN ammessi per il proxy immagini (anti-SSRF: solo questi, solo https).
const IMG_HOST_SUFFIXES = ['.sbito.it', '.subito.it', '.fbcdn.net', '.idealista.it', '.im-cdn.it', '.immobiliare.it'];
function isAllowedImageHost(host: string): boolean {
  return IMG_HOST_SUFFIXES.some((s) => host === s.slice(1) || host.endsWith(s));
}
function imgRefererFor(host: string): string {
  if (host.endsWith('.fbcdn.net')) return 'https://www.facebook.com/';
  if (host.includes('sbito') || host.endsWith('.subito.it')) return 'https://www.subito.it/';
  if (host.endsWith('.idealista.it')) return 'https://www.idealista.it/';
  return 'https://www.immobiliare.it/';
}

// Inoltra le reject degli handler async a Express (altrimenti la richiesta resta appesa).
type AsyncHandler = (req: Request, res: Response) => unknown;
const wrap = (fn: AsyncHandler) => (req: Request, res: Response, next: (e?: unknown) => void) =>
  Promise.resolve(fn(req, res)).catch(next);

function imapConfigured(): boolean {
  return !!(process.env.IMAP_USER && process.env.IMAP_PASS);
}

/** Filtra e ordina i record per la GET /api/listings. */
function queryListings(all: StoredListing[], q: Request['query']): StoredListing[] {
  const channel = typeof q.channel === 'string' ? q.channel : '';
  const status = typeof q.status === 'string' ? q.status : '';
  const city = typeof q.city === 'string' ? q.city.toLowerCase() : '';
  const text = typeof q.q === 'string' ? q.q.toLowerCase() : '';
  const arredato = typeof q.arredato === 'string' ? q.arredato : '';
  const soloPrivati = q.soloPrivati === '1';
  const minScore = q.minScore ? Number(q.minScore) : 0;
  const sort = typeof q.sort === 'string' ? q.sort : 'score';

  let out = all.filter((r) => {
    if (channel && r.channel !== channel) return false;
    if (status && r.status !== status) return false;
    if (minScore > 0 && (r.ai == null || r.ai.score < minScore)) return false;
    if (arredato && r.fields?.arredato !== arredato) return false;
    if (soloPrivati && r.fields?.contatto === 'agenzia') return false;
    if (city) {
      const hay = `${r.listing.zone ?? ''} ${r.listing.title} ${r.listing.url}`.toLowerCase();
      if (!hay.includes(city)) return false;
    }
    if (text) {
      const hay = `${r.listing.title} ${r.listing.zone ?? ''} ${r.listing.desc ?? ''}`.toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });

  const byScore = (a: StoredListing, b: StoredListing) => (b.ai?.score ?? -1) - (a.ai?.score ?? -1);
  const byRecent = (a: StoredListing, b: StoredListing) => b.firstSeen.localeCompare(a.firstSeen);
  const byPrice = (a: StoredListing, b: StoredListing) =>
    (a.listing.price ?? Infinity) - (b.listing.price ?? Infinity);
  out = out.sort(sort === 'recent' ? byRecent : sort === 'price' ? byPrice : byScore);
  return out;
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}
/**
 * I binari dei browser NON sono nel bundle di release (~400 MB) e possono mancare anche dopo un
 * `npm install`. `executablePath()` restituisce il path calcolato anche quando il file non c'è.
 */
function browsersInstalled(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

async function writeFileSafe(path: string, content: string): Promise<void> {
  await writeFileAtomic(path, content); // tmp+rename+.bak: niente file di config troncati
}

export function createApp(deps: AppDeps): Express {
  const store = deps.store;
  const runPipeline = deps.runPipeline ?? realRunPipeline;
  // Path risolti a OGNI richiesta, non una volta all'avvio: `data/local/<file>` creato a runtime
  // (dalla prima PUT) deve valere subito. Legge dal locale se c'è, scrive SEMPRE nel locale —
  // così i file di esempio versionati non vengono mai riscritti con la config personale.
  const readCfg = (k: ConfigKey): string => deps.configPaths?.[k] ?? configReadPath(CONFIG_FILES[k]);
  const writeCfg = (k: ConfigKey): string => deps.configPaths?.[k] ?? localConfigPath(CONFIG_FILES[k]);
  const runManager = new RunManager();

  const app = express();
  app.use(express.json());

  // --- Meta: cosa è disponibile (per abilitare canali/pulsanti nella UI) ---
  app.get('/api/meta', (_req, res) => {
    const fbSessionExists = existsSync(FB_STATE_PATH);
    const imap = imapConfigured();
    const browser = browsersInstalled();
    // Senza browser i canali scraper fallirebbero al primo click: meglio dirlo qui che in uno stack trace.
    const needsBrowser = browser ? '' : 'browser non installato (npx playwright install chromium)';
    res.json({
      aiConfigured: aiConfigured(),
      aiProvider: primaryProvider(),
      imapConfigured: imap,
      fbSessionExists,
      browsersInstalled: browser,
      channels: [
        { id: 'email', label: 'Portali (email)', available: imap, reason: imap ? '' : 'IMAP non configurato' },
        { id: 'subito', label: 'Subito', available: browser, reason: needsBrowser },
        { id: 'immobiliare', label: 'Immobiliare (diretto)', available: browser, reason: needsBrowser },
        { id: 'idealista', label: 'Idealista (diretto)', available: browser, reason: needsBrowser },
        {
          id: 'facebook',
          label: 'Facebook',
          available: fbSessionExists && browser,
          reason: !browser ? needsBrowser : fbSessionExists ? '' : 'sessione FB assente',
        },
      ],
    });
  });

  // --- Image proxy: rifà la richiesta lato server col Referer/UA giusti (miniature Subito/FB
  // hotlink-bloccate). Allowlist host + solo https = niente SSRF verso indirizzi interni. ---
  app.get('/api/img', async (req, res) => {
    const src = typeof req.query.src === 'string' ? req.query.src : '';
    let u: URL;
    try {
      u = new URL(src);
    } catch {
      return res.status(400).end();
    }
    if (u.protocol !== 'https:' || !isAllowedImageHost(u.hostname)) return res.status(400).end();
    try {
      const upstream = await fetch(u.toString(), {
        headers: {
          Referer: imgRefererFor(u.hostname),
          'User-Agent': DESKTOP_UA,
          Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
        },
      });
      if (!upstream.ok) return res.status(502).end();
      const ct = upstream.headers.get('content-type') ?? 'image/jpeg';
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.end(buf);
    } catch {
      res.status(502).end();
    }
  });

  app.use('/api/ai', createAiRouter());

  // --- Listings ---
  app.get('/api/listings', (req, res) => {
    res.json(queryListings(store.all(), req.query));
  });

  /**
   * Aggregati per il tab Profilo. Esiste come endpoint perché l'alternativa è far scaricare
   * al browser mezzo megabyte di annunci per calcolarne dodici numeri, a ogni apertura.
   */
  app.get('/api/stats', (_req, res) => {
    res.json(buildStats(store.all()));
  });

  app.get('/api/listings/:key', (req, res) => {
    const rec = store.get(req.params.key);
    if (!rec) return res.status(404).json({ error: 'non trovato' });
    res.json(rec);
  });

  // Blocca le mutazioni pesanti mentre una run sta scrivendo lo store (evita race con save()).
  const rejectIfRunning = (res: Response): boolean => {
    if (runManager.isRunning) {
      res.status(409).json({ error: 'run in corso: riprova a fine run' });
      return true;
    }
    return false;
  };

  // Richiede Content-Type application/json: una POST cross-site "semplice" non può impostarlo
  // (scatta il preflight CORS) → mitiga la CSRF sugli endpoint distruttivi.
  const requireJson = (req: Request, res: Response): boolean => {
    if (!req.is('application/json')) {
      res.status(415).json({ error: 'Content-Type application/json richiesto' });
      return true;
    }
    return false;
  };

  app.post('/api/listings/reset', wrap(async (req, res) => {
    if (requireJson(req, res)) return;
    if (rejectIfRunning(res)) return;
    const n = store.size;
    store.clear();
    await store.save();
    res.json({ ok: true, cleared: n });
  }));

  // Re-filtro AI-free dei record già in archivio: toglie non-residenziali + rumore FB, azzera prezzi brevi.
  app.post('/api/listings/refilter', wrap(async (req, res) => {
    if (requireJson(req, res)) return;
    if (rejectIfRunning(res)) return;
    const before = store.size;
    store.forEach((r) => {
      const txt = `${r.listing.title} ${r.listing.desc ?? ''}`;
      if (r.listing.price != null && isShortTerm(txt)) r.listing.price = null;
    });
    const removed = store.prune((r) => {
      if (!isResidential(r.listing)) return false;
      if (r.listing.source === 'fb-group' || r.listing.source === 'fb-marketplace') {
        // togli il prefisso "[NomeGruppo · città]" dal desc: i nomi gruppi contengono "Camere/Stanze"
        // e falserebbero il segnale dwelling.
        const desc = (r.listing.desc ?? '').replace(/^\[[^\]]*\]\s*/, '');
        return looksLikeListing(`${r.listing.title} ${desc}`);
      }
      return true;
    });
    await store.save();
    res.json({ ok: true, removed, before, after: store.size });
  }));

  app.patch('/api/listings/:key/status', wrap(async (req, res) => {
    const parsed = StatusSchema.safeParse(req.body?.status);
    if (!parsed.success) return res.status(400).json({ error: 'status non valido' });
    if (!store.setStatus(req.params.key, parsed.data)) return res.status(404).json({ error: 'non trovato' });
    await store.save();
    res.json(store.get(req.params.key));
  }));

  // --- Config (letta fresca dalla pipeline a ogni run: le modifiche valgono dal run successivo) ---
  app.get('/api/config/criteria', async (_req, res) => {
    res.json({ content: await readFile(readCfg('criteria'), 'utf8').catch(() => '') });
  });
  app.put('/api/config/criteria', wrap(async (req, res) => {
    if (rejectIfRunning(res)) return;
    if (typeof req.body?.content !== 'string') return res.status(400).json({ error: 'content mancante' });
    await writeFileSafe(writeCfg('criteria'), req.body.content);
    res.json({ ok: true });
  }));

  app.get('/api/config/searches', async (_req, res) => {
    res.json(await readJson(readCfg('searches'), []));
  });
  app.put('/api/config/searches', wrap(async (req, res) => {
    if (rejectIfRunning(res)) return;
    const parsed = SearchesSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'searches non valido', issues: parsed.error.issues });
    await writeFileSafe(writeCfg('searches'), JSON.stringify(parsed.data, null, 2) + '\n');
    res.json({ ok: true });
  }));

  app.get('/api/config/facebook', async (_req, res) => {
    res.json(await readJson(readCfg('facebook'), { groups: [], market: [] }));
  });
  app.put('/api/config/facebook', wrap(async (req, res) => {
    if (rejectIfRunning(res)) return;
    const parsed = FbConfigSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'facebook non valido', issues: parsed.error.issues });
    await writeFileSafe(writeCfg('facebook'), JSON.stringify(parsed.data, null, 2) + '\n');
    res.json({ ok: true });
  }));

  // --- Runs ---
  app.post('/api/runs', (req, res) => {
    const parsed = RunBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'channels non valido' });
    const channels = parsed.data.channels as ChannelId[];
    try {
      const runId = runManager.start(channels, (log) => runPipeline(channels, { store, log }));
      res.status(202).json({ runId });
    } catch (e) {
      if (e instanceof RunBusyError) return res.status(409).json({ error: 'run in corso', runId: e.runId });
      throw e;
    }
  });

  app.get('/api/runs/current', (_req, res) => {
    res.json(runManager.status());
  });

  app.get('/api/runs/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    const unsub = runManager.subscribe(send);
    const hb = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => {
      clearInterval(hb);
      unsub();
    });
  });

  // --- UI statica (build Vite), con fallback SPA ---
  if (existsSync(UI_DIST)) {
    app.use(express.static(UI_DIST));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(`${UI_DIST}/index.html`));
  }

  // Error-handler finale: qualsiasi reject di un handler async (via wrap) risponde 500 JSON,
  // invece di lasciare la richiesta appesa a tempo indefinito.
  app.use((err: unknown, _req: Request, res: Response, _next: (e?: unknown) => void) => {
    console.error('[server] errore non gestito:', (err as Error)?.message ?? err);
    if (!res.headersSent) res.status(500).json({ error: 'errore interno' });
  });

  return app;
}
