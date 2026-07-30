import type { Listing } from './types.js';
import { dedupKey } from './state.js';
import { matches, isResidential } from './match.js';
import { ListingStore, type StoredListing } from './store.js';
import { scoreBatch, configured as aiConfigured, type ScoreResult } from '../ai/score.js';
import { describePhotos, visionConfigured } from '../ai/vision.js';

/**
 * Pipeline importabile: raccoglie annunci dai canali, li de-duplica, li valuta con l'AI e
 * li persiste in `ListingStore`. Nessun `process.exit`, nessuna notifica: quelle stanno nei
 * wrapper CLI (`src/index.ts`, `scripts/fb-run.ts`) e nel server. Il log è iniettabile
 * (`opts.log`) così il server può streammarlo in SSE; default = `console.log`.
 */

export type LogFn = (msg: string) => void;
export type ChannelId = 'email' | 'subito' | 'immobiliare' | 'idealista' | 'facebook';

const SCRAPER_CHANNELS: ChannelId[] = ['subito', 'immobiliare', 'idealista'];

export interface RunOptions {
  store: ListingStore;
  log?: LogFn;
  /** Se valutare con l'AI. Default: `aiConfigured()` (true se c'è OPENROUTER_API_KEY). */
  score?: boolean;
  /** Se descrivere le foto (stadio vision) prima del reasoning. Default: `visionConfigured()`. */
  vision?: boolean;
}

export interface RunResult {
  channel: ChannelId;
  collected: number; // annunci grezzi raccolti (pre-dedup)
  unique: number; // dopo dedup nel run
  fresh: number; // nuovi rispetto all'archivio
  newRecords: StoredListing[]; // record creati come nuovi in questo run (per la notifica CLI)
  errors: string[];
}

export interface RunSummary {
  runId: string;
  channels: ChannelId[];
  results: RunResult[];
  startedAt: string;
  finishedAt: string;
}

function resolveLog(opts: RunOptions): LogFn {
  return opts.log ?? ((m) => console.log(m));
}
function resolveScore(opts: RunOptions): boolean {
  return opts.score ?? aiConfigured();
}
function empty(channel: ChannelId, errors: string[] = []): RunResult {
  return { channel, collected: 0, unique: 0, fresh: 0, newRecords: [], errors };
}

/**
 * Passo comune: dedup nel run → scoring dei SOLI nuovi → upsert nel store.
 * I nuovi ricevono `ai`/`photos`/`notified`; i già-visti si ri-upsertano senza patch per
 * rinfrescare `lastSeen`/contenuto preservando `ai` e lo `status` scelto dall'utente.
 * NON salva: salva l'orchestratore (`runPipeline`) una volta sola.
 */
export async function ingest(listings: Listing[], channel: ChannelId, opts: RunOptions): Promise<RunResult> {
  const log = resolveLog(opts);
  const doScore = resolveScore(opts);
  const store = opts.store;
  const errors: string[] = [];

  // Scarta i non-residenziali (posti auto/box/garage) prima di tutto.
  const residential = listings.filter(isResidential);
  const dropped = listings.length - residential.length;
  if (dropped) log(`[${channel}] scartati ${dropped} non-residenziali (posti auto/box/…)`);

  const byKey = new Map<string, Listing>();
  for (const l of residential) if (!byKey.has(dedupKey(l))) byKey.set(dedupKey(l), l);
  const unique = [...byKey.values()];
  const freshKeys = new Set(unique.filter((l) => store.isNew(l)).map(dedupKey));

  log(`[${channel}] raccolti ${listings.length} · unici ${unique.length} · nuovi ${freshKeys.size}`);

  let scores = new Map<string, ScoreResult>();
  let visions = new Map<string, string>();
  if (doScore && freshKeys.size) {
    const fresh = unique.filter((l) => freshKeys.has(dedupKey(l)));

    // Stadio 1 (vision): descrive le foto, se attivo. Plus non bloccante.
    if (opts.vision ?? visionConfigured()) {
      try {
        visions = await describePhotos(fresh, log);
        if (visions.size) log(`[${channel}] vision: ${visions.size} foto descritte`);
      } catch (e) {
        log(`[${channel}] vision fallita: ${(e as Error).message}`);
      }
    }

    // Stadio 2 (reasoning): la descrizione foto entra nel `desc` così il voto ne tiene conto.
    const enriched = fresh.map((l) => {
      const v = visions.get(dedupKey(l));
      return v ? { ...l, desc: [l.desc, `FOTO: ${v}`].filter(Boolean).join('\n') } : l;
    });
    try {
      log(`[${channel}] valuto ${enriched.length} annunci con l'AI…`);
      scores = await scoreBatch(enriched, log);
    } catch (e) {
      const msg = `AI scoring fallito: ${(e as Error).message}`;
      log(`[${channel}] ${msg}`);
      errors.push(msg);
    }
  }

  const now = new Date().toISOString();
  const newRecords: StoredListing[] = [];
  for (const l of unique) {
    const isFresh = freshKeys.has(dedupKey(l));
    const res = scores.get(dedupKey(l));
    const rec = isFresh
      ? store.upsert(l, now, {
          channel,
          ai: res?.ai ?? null,
          fields: res?.fields ?? null,
          visionSummary: visions.get(dedupKey(l)) ?? null,
          photos: l.thumb ? [l.thumb] : [],
          notified: false,
        })
      : store.upsert(l, now); // già-visto: rinfresca lastSeen/contenuto, preserva ai/fields/status/channel
    if (isFresh) newRecords.push(rec);
  }

  return { channel, collected: listings.length, unique: unique.length, fresh: freshKeys.size, newRecords, errors };
}

/** Risultato dell'email + commit differito: le mail si marcano lette SOLO dopo un save riuscito. */
interface EmailRun {
  result: RunResult;
  /** Marca `\Seen` le mail dei portali se `saved` è true; chiude SEMPRE la connessione. */
  finalize: (saved: boolean) => Promise<void>;
}

/**
 * Legge le mail non lette (IMAP Virgilio), estrae gli annunci. NON marca lette qui: ritorna un
 * `finalize(saved)` che l'orchestratore chiama DOPO il salvataggio, così un crash/save fallito
 * non lascia mail "lette" ma annunci mai persistiti (che andrebbero persi).
 */
export async function runEmail(opts: RunOptions): Promise<EmailRun> {
  const log = resolveLog(opts);
  const { Mailbox } = await import('../sources/email/imap.js');
  const { emailSources } = await import('../sources/email/index.js');
  const noop: EmailRun = { result: empty('email', ['IMAP non configurato']), finalize: async () => {} };

  if (!Mailbox.configured()) {
    log('[email] IMAP non configurato (IMAP_USER/IMAP_PASS) → salto.');
    return noop;
  }

  const box = new Mailbox();
  const collected: Listing[] = [];
  const processed: number[] = [];
  await box.open();
  try {
    const msgs = await box.fetchUnread();
    for (const msg of msgs) {
      const src = emailSources.find((s) => s.matchesSender(msg.from));
      if (!src) continue; // mittente non-portale → NON toccare (resta non letta, è posta personale)
      for (const l of src.parse(msg.html, msg.text)) collected.push(l);
      processed.push(msg.uid); // candidate a "lette": SOLO le mail dei portali riconosciuti
    }
    log(`[email] ${msgs.length} non lette · ${processed.length} da portali`);
    const result = await ingest(collected, 'email', opts);
    const finalize = async (saved: boolean): Promise<void> => {
      try {
        if (saved && processed.length) {
          await box.markSeen(processed);
          log(`[email] ${processed.length} marcate lette (dopo salvataggio)`);
        } else if (!saved && processed.length) {
          log('[email] salvataggio non riuscito → mail NON marcate lette (verranno riprocessate)');
        }
      } finally {
        await box.close();
      }
    };
    return { result, finalize };
  } catch (e) {
    await box.close();
    throw e;
  }
}

/**
 * Scraper browser headed (solo PC): Subito / Immobiliare / Idealista.
 * Import dinamico di Playwright (il resto della pipeline resta leggero). Filtra le `sources`
 * per nome-canale e applica il filtro `matches` del profilo. Un `RunResult` per canale.
 */
export async function runScrapers(channels: ChannelId[], opts: RunOptions): Promise<RunResult[]> {
  const log = resolveLog(opts);
  const wanted = channels.filter((c) => SCRAPER_CHANNELS.includes(c));
  if (!wanted.length) return [];

  const { loadSearches } = await import('../config/searches.js');
  const { sources } = await import('../sources/index.js');
  const { launchBrowser, newContext } = await import('./browser.js');

  const active = sources.filter((s) => wanted.includes(s.name as ChannelId));
  if (!active.length) {
    log(`[scrapers] nessuno scraper registrato per: ${wanted.join(', ')}`);
    return wanted.map((c) => empty(c, ['scraper non registrato']));
  }

  const searches = loadSearches();
  const collectedBy = new Map<ChannelId, Listing[]>();
  const errorsBy = new Map<ChannelId, string[]>();
  for (const s of active) collectedBy.set(s.name as ChannelId, []);

  const browser = await launchBrowser();
  try {
    const ctx = await newContext(browser); // dentro il try: se lancia, il browser viene comunque chiuso
    try {
      for (const profile of searches) {
        for (const source of active) {
          const ch = source.name as ChannelId;
          try {
            const listings = await source.fetch(profile, ctx);
            const bucket = collectedBy.get(ch)!;
            for (const l of listings) if (matches(l, profile)) bucket.push(l);
          } catch (e) {
            const msg = `${profile.id}: ${(e as Error).message}`;
            log(`[${ch}] ERRORE ${msg}`);
            const es = errorsBy.get(ch) ?? [];
            es.push(msg);
            errorsBy.set(ch, es);
          }
        }
      }
    } finally {
      await ctx.close();
    }
  } finally {
    await browser.close();
  }

  const results: RunResult[] = [];
  for (const source of active) {
    const ch = source.name as ChannelId;
    const r = await ingest(collectedBy.get(ch) ?? [], ch, opts);
    r.errors.push(...(errorsBy.get(ch) ?? []));
    results.push(r);
  }
  return results;
}

/** Scraper Facebook (gruppi + Marketplace) su context loggato. Richiede una sessione salvata. */
export async function runFacebook(opts: RunOptions): Promise<RunResult> {
  const log = resolveLog(opts);
  const { existsSync } = await import('node:fs');
  const { FB_STATE_PATH, FB_MAX_SCROLL, loadFbConfig } = await import('../config/facebook.js');

  if (!existsSync(FB_STATE_PATH)) {
    log(`[facebook] sessione assente (${FB_STATE_PATH}). Lancia: npm run fb:from-brave (o fb:login)`);
    return empty('facebook', [`sessione assente: ${FB_STATE_PATH}`]);
  }

  const { launchBrowser, newContext } = await import('./browser.js');
  const { isLoggedIn } = await import('../sources/fb-session.js');
  const { scrapeGroups } = await import('../sources/facebook-groups.js');
  const { scrapeMarketplace } = await import('../sources/facebook-marketplace.js');
  const { groups, market } = loadFbConfig();

  const collected: Listing[] = [];
  const browser = await launchBrowser();
  try {
    const ctx = await newContext(browser, { storageState: FB_STATE_PATH });
    try {
      if (!(await isLoggedIn(ctx))) {
        log('[facebook] sessione scaduta/non valida. Rilancia: npm run fb:from-brave (o fb:login)');
        return empty('facebook', ['sessione scaduta']);
      }
      // Gruppi e Marketplace isolati: uno che fallisce non fa saltare l'altro.
      try {
        collected.push(...(await scrapeGroups(ctx, groups, FB_MAX_SCROLL)));
      } catch (e) {
        log(`[facebook] gruppi falliti: ${(e as Error).message}`);
      }
      try {
        collected.push(...(await scrapeMarketplace(ctx, market, FB_MAX_SCROLL)));
      } catch (e) {
        log(`[facebook] marketplace fallito: ${(e as Error).message}`);
      }
    } finally {
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  return ingest(collected, 'facebook', opts);
}

/**
 * Orchestratore: lancia i canali richiesti ISOLATI (uno che fallisce non abbatte gli altri),
 * salva l'archivio DOPO OGNI canale (durabilità incrementale) e aggrega i `RunResult`.
 * Usato sia dal server sia dai wrapper CLI.
 */
export async function runPipeline(channels: ChannelId[], opts: RunOptions): Promise<RunSummary> {
  const log = resolveLog(opts);
  const startedAt = new Date().toISOString();
  const runId = `run_${Date.now().toString(36)}`;
  const results: RunResult[] = [];
  const scraperChannels = channels.filter((c) => SCRAPER_CHANNELS.includes(c));

  const save = async (label: string): Promise<boolean> => {
    try {
      await opts.store.save();
      return true;
    } catch (e) {
      log(`[${label}] ERRORE salvataggio: ${(e as Error).message}`);
      return false;
    }
  };

  if (channels.includes('email')) {
    try {
      const { result, finalize } = await runEmail(opts);
      results.push(result);
      const saved = await save('email');
      await finalize(saved); // markSeen SOLO dopo un save riuscito
    } catch (e) {
      log(`[email] ERRORE canale: ${(e as Error).message}`);
      results.push(empty('email', [`email: ${(e as Error).message}`]));
    }
  }

  if (scraperChannels.length) {
    try {
      results.push(...(await runScrapers(scraperChannels, opts)));
    } catch (e) {
      log(`[scrapers] ERRORE canale: ${(e as Error).message}`);
      for (const c of scraperChannels) results.push(empty(c, [`scrapers: ${(e as Error).message}`]));
    }
    await save('scrapers');
  }

  if (channels.includes('facebook')) {
    try {
      results.push(await runFacebook(opts));
    } catch (e) {
      log(`[facebook] ERRORE canale: ${(e as Error).message}`);
      results.push(empty('facebook', [`facebook: ${(e as Error).message}`]));
    }
    await save('facebook');
  }

  const finishedAt = new Date().toISOString();
  const totFresh = results.reduce((n, r) => n + r.fresh, 0);
  log(`✅ Run ${runId} · nuovi totali: ${totFresh} · in archivio: ${opts.store.size}`);
  return { runId, channels, results, startedAt, finishedAt };
}
