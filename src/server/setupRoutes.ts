import { rm } from 'node:fs/promises';
import { Router, type Request, type Response } from 'express';
import { ImapFlow } from 'imapflow';
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
import { loginToFacebook, readSession } from '../sources/fb-login.js';
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

export function createSetupRouter(jobs: JobManager): Router {
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
    res.json(readSession());
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

  r.delete('/facebook/session', async (_req, res) => {
    await rm(FB_STATE_PATH, { force: true }).catch(() => {});
    res.json({ ok: true });
  });

  // --- Browser --------------------------------------------------------------------------------

  r.post('/system/install-browsers', (req, res) => {
    if (requireJson(req, res)) return;
    startJob('install-browsers', res, (log) => installBrowsers(log));
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
