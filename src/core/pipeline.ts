import type { Listing } from './types.js';
import { dedupKey } from './state.js';
import { matches, isResidential } from './match.js';
import { ListingStore, type StoredListing } from './store.js';
import { scoreBatch, configured as aiConfigured, type ScoreResult } from '../ai/score.js';
import { describePhotos, visionConfigured } from '../ai/vision.js';
import { cacheThumbs, isCachedThumb, pruneThumbs } from './thumbs.js';
import { beginScoringTask, endScoringTask } from '../ai/endpoint-health.js';

/**
 * Pipeline importabile: raccoglie annunci dai canali, li de-duplica, li valuta con l'AI e
 * li persiste in `ListingStore`. Nessun `process.exit`, nessuna notifica: quelle stanno nei
 * wrapper CLI (`src/index.ts`, `scripts/fb-run.ts`) e nel server. Il log è iniettabile
 * (`opts.log`) così il server può streammarlo in SSE; default = `console.log`.
 */

export type LogFn = (msg: string) => void;
export type ChannelId = 'email' | 'subito' | 'immobiliare' | 'idealista' | 'facebook';
export type RunOutcome = 'succeeded' | 'partial' | 'failed';

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
  outcome?: RunOutcome;
  /** Non definito prima del salvataggio; false impedisce notifiche di dati non persistiti. */
  persisted?: boolean;
}

export interface RunSummary {
  runId: string;
  channels: ChannelId[];
  results: RunResult[];
  startedAt: string;
  finishedAt: string;
  outcome?: RunOutcome;
}

function resolveLog(opts: RunOptions): LogFn {
  return opts.log ?? ((m) => console.log(m));
}
function resolveScore(opts: RunOptions): boolean {
  return opts.score ?? aiConfigured();
}
function empty(channel: ChannelId, errors: string[] = []): RunResult {
  return { channel, collected: 0, unique: 0, fresh: 0, newRecords: [], errors, outcome: errors.length ? 'failed' : 'succeeded' };
}

function resultOutcome(result: RunResult): RunOutcome {
  if (result.persisted === false) return 'failed';
  return result.errors.length ? (result.unique ? 'partial' : 'failed') : 'succeeded';
}

/**
 * Copia in locale le miniature del run (vedi `core/thumbs.ts` per il perché).
 * I nuovi le prendono sempre; i già-visti solo se in archivio hanno ancora un URL remoto —
 * self-heal una volta sola per annuncio, senza ri-scaricare a ogni run quello che è già in cache.
 * Ritorna: dedupKey → percorso `/thumbs/…`.
 */
async function cachePhotos(
  unique: Listing[],
  freshKeys: Set<string>,
  store: ListingStore,
  channel: ChannelId,
  log: LogFn,
): Promise<Map<string, string>> {
  const targets = unique.filter((l) => {
    if (!l.thumb) return false;
    if (freshKeys.has(dedupKey(l))) return true;
    return !isCachedThumb(store.get(dedupKey(l))?.photos[0]);
  });
  const out = new Map<string, string>();
  if (!targets.length) return out;

  const byUrl = await cacheThumbs(targets.map((l) => l.thumb as string));
  for (const l of targets) {
    const p = byUrl.get(l.thumb as string);
    if (p) out.set(dedupKey(l), p);
  }
  log(`[${channel}] miniature: ${out.size}/${targets.length} copiate in locale`);
  return out;
}

/**
 * Passo comune: dedup nel run → scoring dei nuovi e di chi ha `ai:null` → upsert nel store.
 * I già valutati conservano l'AI; tutti preservano lo `status` scelto dall'utente.
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
  const scoreTargets = unique.filter((l) => freshKeys.has(dedupKey(l)) || !store.get(dedupKey(l))?.ai);

  log(`[${channel}] raccolti ${listings.length} · unici ${unique.length} · nuovi ${freshKeys.size}`);

  // Prima di tutto il resto: le foto in locale. Serve al vision (i provider non arrivano alle CDN
  // hotlink-bloccate) e all'archivio (gli URL Facebook scadono in pochi giorni).
  const photoOf = await cachePhotos(unique, freshKeys, store, channel, log);

  let scores = new Map<string, ScoreResult>();
  let visions = new Map<string, string>();
  if (doScore && scoreTargets.length) {
    // Stadio 1 (vision): descrive le foto, se attivo. Plus non bloccante.
    if (opts.vision ?? visionConfigured()) {
      try {
        visions = await describePhotos(scoreTargets, log, photoOf);
        if (visions.size) log(`[${channel}] vision: ${visions.size} foto descritte`);
      } catch (e) {
        log(`[${channel}] vision fallita: ${(e as Error).message}`);
      }
    }

    // Stadio 2 (reasoning): la descrizione foto entra nel `desc` così il voto ne tiene conto.
    const enriched = scoreTargets.map((l) => {
      const v = visions.get(dedupKey(l));
      return v ? { ...l, desc: [l.desc, `FOTO: ${v}`].filter(Boolean).join('\n') } : l;
    });
    try {
      log(`[${channel}] valuto ${enriched.length} annunci con l'AI…`);
      scores = await scoreBatch(enriched, log, { resetPenalties: false });
      const missing = enriched.filter((l) => !scores.has(dedupKey(l))).length;
      if (missing) {
        const msg = `Valutazione AI assente per ${missing}/${enriched.length} annunci; riproverò alla prossima scansione`;
        log(`[${channel}] ${msg}`);
        errors.push(msg);
      }
    } catch (e) {
      const msg = `AI scoring fallito: ${(e as Error).message}`;
      log(`[${channel}] ${msg}`);
      errors.push(msg);
    }
  }

  const now = new Date().toISOString();
  const newRecords: StoredListing[] = [];
  for (const l of unique) {
    const key = dedupKey(l);
    const isFresh = freshKeys.has(key);
    const res = scores.get(key);
    // Copia locale se c'è, altrimenti l'URL remoto: meglio un hotlink che una card vuota.
    const local = photoOf.get(key);
    const photo = local ?? l.thumb ?? null;
    const rec = isFresh
      ? store.upsert(l, now, {
          channel,
          ai: res?.ai ?? null,
          fields: res?.fields ?? null,
          visionSummary: visions.get(key) ?? null,
          photos: photo ? [photo] : [],
          notified: false,
        })
      : // già-visto: recupera solo l'AI mancante; preserva status/channel/notified.
        // `photos` solo se abbiamo appena messo in cache la foto (self-heal degli URL scaduti).
        store.upsert(l, now, {
          ...(local ? { photos: [local] } : {}),
          ...(res ? { ai: res.ai, fields: res.fields, visionSummary: visions.get(key) } : {}),
        });
    if (isFresh) newRecords.push(rec);
  }

  return { channel, collected: listings.length, unique: unique.length, fresh: freshKeys.size, newRecords, errors, outcome: errors.length ? 'partial' : 'succeeded' };
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
  const { createEmailLinkResolver } = await import('../sources/email/tracking-links.js');
  const noop: EmailRun = { result: empty('email', ['IMAP non configurato']), finalize: async () => {} };

  if (!Mailbox.configured()) {
    log('[email] IMAP non configurato (IMAP_USER/IMAP_PASS) → salto.');
    return noop;
  }

  const box = new Mailbox();
  const collected: Listing[] = [];
  const processed: number[] = [];
  const errors: string[] = [];
  const resolver = createEmailLinkResolver();
  await box.open();
  try {
    const msgs = await box.fetchUnread();
    for (const msg of msgs) {
      const src = emailSources.find((s) => s.matchesSender(msg.from));
      if (!src) continue; // mittente non-portale → NON toccare (resta non letta, è posta personale)
      try {
        const resolved = src.resolve ? await src.resolve(msg.html, msg.text, resolver) : null;
        const listings = resolved?.listings ?? src.parse(msg.html, msg.text);
        if (!listings.length) throw new Error('nessun annuncio riconosciuto: formato email da verificare');
        collected.push(...listings);
        if (resolved && !resolved.complete) throw new Error(`estrazione parziale: ${resolved.unresolved} link annuncio non risolti`);
        processed.push(msg.uid); // Solo mail con estrazione riuscita, dopo la persistenza.
      } catch (e) {
        const error = `email UID ${msg.uid} (${src.name}): ${(e as Error).message}; lasciata non letta`;
        errors.push(error);
        log(`[email] ${error}`);
      }
    }
    log(`[email] ${msgs.length} non lette · ${processed.length} da portali`);
    log(`[email] redirect: ${resolver.stats.requests}/120 HEAD · ${resolver.stats.cacheHits} in cache${resolver.stats.exhausted ? ' · limite raggiunto, mail incomplete lasciate non lette' : ''}`);
    const result = await ingest(collected, 'email', opts);
    result.errors.push(...errors);
    result.outcome = resultOutcome(result);
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
  const succeededBy = new Map<ChannelId, number>();
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
            succeededBy.set(ch, (succeededBy.get(ch) ?? 0) + 1);
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
    r.outcome = resultOutcome(r);
    if (r.outcome === 'failed' && succeededBy.get(ch)) r.outcome = 'partial';
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
  const errors: string[] = [];
  const onError = (message: string) => {
    errors.push(message);
    log(`[facebook] ${message}`);
  };
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
        collected.push(...(await scrapeGroups(ctx, groups, FB_MAX_SCROLL, onError)));
      } catch (e) {
        onError(`gruppi falliti: ${(e as Error).message}`);
      }
      try {
        collected.push(...(await scrapeMarketplace(ctx, market, FB_MAX_SCROLL, onError)));
      } catch (e) {
        onError(`marketplace fallito: ${(e as Error).message}`);
      }
    } finally {
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  const result = await ingest(collected, 'facebook', opts);
  result.errors.push(...errors);
  result.outcome = resultOutcome(result);
  return result;
}

/**
 * Orchestratore: lancia i canali richiesti ISOLATI (uno che fallisce non abbatte gli altri),
 * salva l'archivio DOPO OGNI canale (durabilità incrementale) e aggrega i `RunResult`.
 * Usato sia dal server sia dai wrapper CLI.
 */
export async function runPipeline(channels: ChannelId[], opts: RunOptions): Promise<RunSummary> {
  const { loadSearches } = await import('../config/searches.js');
  if (!loadSearches().length) {
    throw Object.assign(new Error('Configura almeno una ricerca prima di avviare la scansione.'), { code: 'PROFILE_NOT_CONFIGURED' });
  }
  beginScoringTask();
  try {
    return await executePipeline(channels, opts);
  } finally {
    endScoringTask();
  }
}

async function executePipeline(channels: ChannelId[], opts: RunOptions): Promise<RunSummary> {
  const log = resolveLog(opts);
  const startedAt = new Date().toISOString();
  const runId = `run_${Date.now().toString(36)}`;
  const results: RunResult[] = [];
  const scraperChannels = channels.filter((c) => SCRAPER_CHANNELS.includes(c));

  let saveFailed = false;
  const save = async (label: string, affected: RunResult[], checkpoint: ReturnType<ListingStore['checkpoint']>): Promise<boolean> => {
    try {
      await opts.store.save();
      for (const result of affected) result.persisted = true;
      return true;
    } catch (e) {
      saveFailed = true;
      opts.store.restoreCheckpoint(checkpoint);
      const message = `salvataggio fallito: ${(e as Error).message}`;
      log(`[${label}] ERRORE ${message}`);
      for (const result of affected) {
        result.errors.push(message);
        result.persisted = false;
        result.outcome = 'failed';
        result.newRecords = [];
        result.fresh = 0;
      }
      return false;
    }
  };

  if (channels.includes('email')) {
    const checkpoint = opts.store.checkpoint();
    try {
      const { result, finalize } = await runEmail(opts);
      results.push(result);
      const saved = await save('email', [result], checkpoint);
      try {
        await finalize(saved); // markSeen SOLO dopo un save riuscito
      } catch (e) {
        const message = `finalizzazione email fallita: ${(e as Error).message}`;
        log(`[email] ERRORE ${message}`);
        result.errors.push(message);
        result.outcome = resultOutcome(result);
      }
    } catch (e) {
      log(`[email] ERRORE canale: ${(e as Error).message}`);
      results.push(empty('email', [`email: ${(e as Error).message}`]));
    }
  }

  if (scraperChannels.length) {
    const checkpoint = opts.store.checkpoint();
    const channelResults: RunResult[] = [];
    try {
      channelResults.push(...(await runScrapers(scraperChannels, opts)));
    } catch (e) {
      log(`[scrapers] ERRORE canale: ${(e as Error).message}`);
      for (const c of scraperChannels) channelResults.push(empty(c, [`scrapers: ${(e as Error).message}`]));
    }
    results.push(...channelResults);
    await save('scrapers', channelResults, checkpoint);
  }

  if (channels.includes('facebook')) {
    const checkpoint = opts.store.checkpoint();
    let result: RunResult;
    try {
      result = await runFacebook(opts);
    } catch (e) {
      log(`[facebook] ERRORE canale: ${(e as Error).message}`);
      result = empty('facebook', [`facebook: ${(e as Error).message}`]);
    }
    results.push(result);
    await save('facebook', [result], checkpoint);
  }

  // Le miniature degli annunci potati resterebbero su disco per sempre. Best-effort: una pulizia
  // fallita non è mai un buon motivo per far fallire un run.
  if (!saveFailed) {
    try {
      const removed = await pruneThumbs(opts.store.all().flatMap((r) => r.photos));
      if (removed) log(`🧹 miniature non più referenziate: ${removed} rimosse`);
    } catch {
      /* ignora */
    }
  }

  const finishedAt = new Date().toISOString();
  const totFresh = results.reduce((n, r) => n + r.fresh, 0);
  const outcome: RunOutcome = results.every((r) => r.outcome === 'succeeded')
    ? 'succeeded'
    : results.every((r) => r.outcome === 'failed') ? 'failed' : 'partial';
  const label = outcome === 'succeeded' ? '✅ completata' : outcome === 'partial' ? '⚠️ completata con problemi' : '❌ fallita';
  log(`${label} · Run ${runId} · nuovi salvati: ${totFresh} · in memoria: ${opts.store.size}`);
  return { runId, channels, results, startedAt, finishedAt, outcome };
}
