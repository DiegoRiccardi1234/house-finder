import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { Router, type Request, type Response } from 'express';
import { ImapFlow } from 'imapflow';
import { CITIES, isKnownCity } from '../config/cities.js';
import { FB_STATE_PATH } from '../config/facebook.js';
import {
  invalidateMail,
  mailPublic,
  mailSettings,
  saveMail,
  DEFAULT_MAIL_FOLDER,
  DEFAULT_MAIL_HOST,
  DEFAULT_MAIL_PORT,
} from '../config/mail.js';
import {
  cleanArea,
  cleanLandmark,
  invalidateProfile,
  loadProfile,
  normalizeProfile,
  profileConfigured,
  renderCriteria,
  saveProfile,
  SEARCH_KINDS,
  type CityZones,
  type Profile,
  type SearchKind,
  type SearchRow,
} from '../config/profile.js';
import { loginToFacebook, readSession } from '../sources/fb-login.js';
import { braveAvailable, importFacebookFrom, isFbBrowserId, listFbBrowsers, type FbBrowserId } from '../sources/fb-import.js';
import { fbProfileDir, profileInUse } from '../sources/fb-session.js';
import { browsersInstalled, installBrowsers } from './browsers.js';
import { JobBusyError, JobManager, type JobId } from './jobs.js';

/**
 * Tutto quello che prima si faceva solo da terminale.
 *
 * Il principio: **l'app deve essere usabile da chi ha scaricato uno zip e ha fatto doppio click**.
 * Un pulsante che apre una console, o una password da scrivere in un file di testo col blocco
 * note, sono la stessa barriera di un comando da digitare — solo travestita meglio.
 *
 * Tre cose vivevano fuori: l'accesso a Facebook (`fb:from-brave`, per giunta impossibile dal
 * bundle, dove npm non c'è), le credenziali della posta (solo `.env`) e l'installazione dei
 * browser (`install-browsers.bat`).
 */

/** Etichette pulite e senza doppioni: le liste arrivano da campi di testo, non da un database. */
function cleanList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out = v
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter((x) => x.length > 0 && x.length < 60);
  return Array.from(new Set(out));
}

/** Identificatore stabile e prevedibile a partire da un'etichetta scritta a mano. */
function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

export function createSetupRouter(jobs: JobManager, onProfileSaved?: (p: Profile) => Promise<unknown>): Router {
  const r = Router();

  const requireJson = (req: Request, res: Response): boolean => {
    if (!req.is('application/json')) {
      res.status(415).json({ error: 'Content-Type application/json richiesto' });
      return true;
    }
    return false;
  };

  const startJob = (
    id: JobId,
    res: Response,
    exec: (log: (line: string) => void) => Promise<string | void>,
  ): void => {
    try {
      jobs.start(id, exec);
      res.status(202).json({ started: true });
    } catch (e) {
      if (e instanceof JobBusyError) {
        res.status(409).json({ error: 'job_in_progress', detail: 'È già in corso.' });
        return;
      }
      res.status(500).json({ error: (e as Error).message });
    }
  };

  r.get('/jobs/:id', (req, res) => {
    const id = req.params.id;
    if (id !== 'fb-login' && id !== 'install-browsers') {
      return res.status(404).json({ error: 'lavoro sconosciuto' });
    }
    res.json(jobs.state(id));
  });

  // --- Facebook -------------------------------------------------------------------------------

  r.get('/facebook/session', (_req, res) => {
    res.json({
      ...readSession(),
      browsers: listFbBrowsers(),
      // Il profilo dell'app esiste: Facebook ha già visto questo computer, niente verifica nuova.
      profileReady: existsSync(fbProfileDir()),
      braveAvailable: braveAvailable(), // per le UI di prima della 1.9
    });
  });

  /**
   * Prende la sessione da un browser in cui si è già dentro. Stesso id di lavoro del login: i due
   * scrivono lo stesso file, quindi non devono mai girare insieme.
   */
  const importFrom = (browser: FbBrowserId, res: Response): void => {
    const label = listFbBrowsers().find((b) => b.id === browser)?.label ?? browser;
    startJob('fb-login', res, async (log) => {
      const id = await importFacebookFrom(browser, log);
      return `Collegato all'account ${id}, sessione presa da ${label}.`;
    });
  };

  r.post('/facebook/import', (req, res) => {
    if (requireJson(req, res)) return;
    const browser = (req.body as { browser?: unknown } | undefined)?.browser;
    if (!isFbBrowserId(browser)) {
      return res.status(400).json({ error: 'unknown_browser', detail: 'Scegli un browser dall\'elenco.' });
    }
    const entry = listFbBrowsers().find((b) => b.id === browser)!;
    if (!entry.importable) {
      return res.status(400).json({ error: 'not_importable', detail: entry.note ?? `Da ${entry.label} non si può.` });
    }
    importFrom(browser, res);
  });

  r.post('/facebook/import-brave', (req, res) => {
    if (requireJson(req, res)) return;
    importFrom('brave', res);
  });

  /**
   * Apre un browser vero e aspetta che l'utente acceda.
   *
   * Il 2FA non è un ostacolo qui, ed è il motivo per cui questa via batte la scorciatoia da
   * Brave: il codice non deve indovinarlo l'app, lo digita la persona nella finestra aperta.
   */
  r.post('/facebook/login', (req, res) => {
    if (requireJson(req, res)) return;
    if (!browsersInstalled()) {
      return res.status(409).json({
        error: 'browsers_missing',
        detail: 'Servono i browser: installali da Config → App, poi riprova.',
      });
    }
    startJob('fb-login', res, async (log) => {
      const id = await loginToFacebook(log);
      return id ? `Collegato all'account ${id}.` : 'Sessione salvata.';
    });
  });

  /**
   * Di default toglie solo la sessione: il profilo del browser dell'app resta, così Facebook
   * continua a riconoscere il computer e il prossimo accesso non richiede la verifica.
   * `{ all: true }` (o `?all=1`) cancella anche quello — serve per cambiare account o ripartire da zero.
   */
  r.delete('/facebook/session', async (req, res) => {
    const body = (req.body ?? {}) as { all?: unknown };
    const all = body.all === true || req.query.all === '1' || req.query.all === 'true';
    if (all) {
      const dir = fbProfileDir();
      if (jobs.isRunning('fb-login') || profileInUse(dir)) {
        return res.status(409).json({ error: 'fb_busy', detail: 'Facebook è aperto da un accesso o da una scansione: aspetta che finisca e riprova.' });
      }
      await rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    }
    await rm(FB_STATE_PATH, { force: true }).catch(() => {});
    res.json({ ok: true, ...(all ? { profileRemoved: !existsSync(fbProfileDir()) } : {}) });
  });

  // --- Browser --------------------------------------------------------------------------------

  r.post('/system/install-browsers', (req, res) => {
    if (requireJson(req, res)) return;
    startJob('install-browsers', res, (log) => installBrowsers(log));
  });

  // --- La tua ricerca -------------------------------------------------------------------------

  /**
   * Le città fra cui si può scegliere.
   *
   * Esiste perché la schermata smetta di essere un campo di testo: scrivere una città che i
   * portali non sanno aprire non deve essere possibile, non deve essere solo sconsigliato.
   */
  r.get('/cities', (_req, res) => {
    res.json(CITIES.map((c) => ({ slug: c.slug, label: c.label, region: c.region })));
  });

  /**
   * Il profilo di ricerca, più il testo che ne viene generato per l'AI.
   *
   * `generated` torna al client di proposito: la schermata lo mostra in un blocco richiudibile,
   * così chi vuole capire *cosa legge davvero il modello* può guardarlo invece di fidarsi. Era
   * l'unica cosa buona dell'editor grezzo di prima, e sarebbe stato un peccato perderla.
   */
  r.get('/config/profile', (_req, res) => {
    const p = loadProfile();
    res.json({ profile: p, generated: renderCriteria(p), configured: profileConfigured() });
  });

  r.put('/config/profile', async (req, res) => {
    if (requireJson(req, res)) return;
    const b = req.body as Partial<Profile>;
    if (!Array.isArray(b.searches)) {
      return res.status(400).json({ error: 'profilo non valido: manca searches' });
    }

    const searches: SearchRow[] = [];
    const scartate: string[] = [];
    for (const raw of b.searches) {
      const s = raw as Partial<SearchRow>;
      const city = typeof s.city === 'string' ? s.city.trim().toLowerCase() : '';
      const label = typeof s.label === 'string' ? s.label.trim() : '';
      const maxPrice = Number(s.maxPrice);
      // Una città fuori elenco non si salva: gli scraper non saprebbero aprirla e la scansione
      // girerebbe a vuoto senza dire niente. Prima veniva accettata qualunque stringa.
      if (city && !isKnownCity(city)) {
        return res.status(400).json({
          error: 'unknown_city',
          city,
          detail: `"${city}" non è fra le città disponibili. Scegline una dall'elenco.`,
        });
      }
      if (!city || !label || !Number.isFinite(maxPrice) || maxPrice <= 0) {
        if (city || label) scartate.push(label || city);
        continue;
      }
      searches.push({
        // L'id compare nei log e nei messaggi d'errore. Si ricava dall'etichetta, che di solito
        // comincia già con la città: anteporla di nuovo dava "bologna-bologna-bilocale".
        id: typeof s.id === 'string' && s.id ? s.id : slug(label) || slug(city),
        city,
        label,
        maxPrice: Math.round(maxPrice),
        ...(Number.isFinite(Number(s.minRooms)) && Number(s.minRooms) > 0
          ? { minRooms: Math.round(Number(s.minRooms)) }
          : {}),
        ...(Number.isFinite(Number(s.maxRooms)) && Number(s.maxRooms) > 0
          ? { maxRooms: Math.round(Number(s.maxRooms)) }
          : {}),
        ...(SEARCH_KINDS.includes(s.tipo as SearchKind) ? { tipo: s.tipo as SearchKind } : {}),
      });
    }

    const zones: CityZones[] = (Array.isArray(b.zones) ? b.zones : [])
      .map((z) => z as Partial<CityZones>)
      .filter((z) => typeof z.city === 'string')
      .map((z) => {
        const out: CityZones = {
          city: (z.city as string).trim().toLowerCase(),
          keep: cleanList(z.keep),
          avoid: cleanList(z.avoid),
        };
        const area = cleanArea(z.area);
        const riferimento = cleanLandmark(z.riferimento);
        if (area) out.area = area;
        if (riferimento) out.riferimento = riferimento;
        return out;
      });

    // Chi cerca casa e soglia passano dallo stesso normalizzatore della lettura da disco.
    const extra = normalizeProfile({ searches: [], tenant: b.tenant, askThreshold: b.askThreshold });
    const profile: Profile = {
      searches,
      zones,
      musts: cleanList(b.musts),
      notes: typeof b.notes === 'string' ? b.notes : '',
      ...(extra.tenant ? { tenant: extra.tenant } : {}),
      ...(extra.askThreshold != null ? { askThreshold: extra.askThreshold } : {}),
    };

    await saveProfile(profile);
    invalidateProfile();
    // Le regole dipendono dal profilo: un tetto più alto o un'area più larga rimette in lista
    // quello che prima era fuori, senza aspettare la prossima scansione.
    await onProfileSaved?.(profile).catch(() => {});
    res.json({
      profile,
      generated: renderCriteria(profile),
      configured: profileConfigured(),
      // Le righe lasciate a metà venivano buttate in silenzio: dopo il salvataggio sparivano e
      // basta. Ora chi salva sa che cosa non è stato tenuto e perché.
      ...(scartate.length ? { skipped: scartate } : {}),
    });
  });

  // --- Posta ----------------------------------------------------------------------------------

  /** La password non esce mai da qui: verso la UI vanno host, utente e un booleano. */
  r.get('/config/mail', (_req, res) => {
    res.json({
      ...mailPublic(),
      defaults: {
        host: DEFAULT_MAIL_HOST,
        port: DEFAULT_MAIL_PORT,
        folder: DEFAULT_MAIL_FOLDER,
      },
    });
  });

  r.put('/config/mail', async (req, res) => {
    if (requireJson(req, res)) return;
    const b = req.body as Record<string, unknown>;
    const str = (k: string): string | undefined => (typeof b[k] === 'string' ? (b[k] as string) : undefined);
    const port = typeof b.port === 'number' && Number.isFinite(b.port) ? b.port : undefined;

    await saveMail({
      host: str('host'),
      user: str('user'),
      // Campo vuoto = "non l'ho toccato", non "cancellala": la UI non ripropone mai il segreto,
      // quindi salvare l'host con la password in bianco la cancellerebbe a ogni modifica.
      pass: str('pass') ? str('pass') : undefined,
      folder: str('folder'),
      port,
    });
    invalidateMail();
    res.json(mailPublic());
  });

  r.delete('/config/mail', async (_req, res) => {
    await saveMail({ host: '', user: '', pass: '', folder: '', port: undefined });
    invalidateMail();
    res.json(mailPublic());
  });

  /**
   * Prova davvero a collegarsi.
   *
   * Le key AI si verificano da sole al salvataggio (se la lista modelli arriva, la key è buona);
   * per la posta l'equivalente è aprire la connessione. Senza, un errore di password si scopre
   * solo alla prima scansione, dentro un log.
   */
  r.post('/config/mail/test', async (req, res) => {
    if (requireJson(req, res)) return;
    const s = mailSettings();
    if (!s.user || !s.pass) {
      return res.status(400).json({ ok: false, error: 'Utente o password mancanti.' });
    }
    const client = new ImapFlow({
      host: s.host,
      port: s.port,
      secure: true,
      auth: { user: s.user, pass: s.pass },
      logger: false,
    });
    try {
      await client.connect();
      const box = await client.mailboxOpen(s.folder);
      res.json({ ok: true, folder: s.folder, messages: box.exists });
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
    } finally {
      await client.logout().catch(() => client.close());
    }
  });

  return r;
}
