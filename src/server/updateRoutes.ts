import { Router, type Request, type Response } from 'express';
import { checkForUpdate, resetCheckCache, type UpdateInfo } from '../update/check.js';
import { lastEvent, writeEvent } from '../update/events.js';
import {
  acquireLock,
  readLock,
  releaseLock,
  startHeartbeat,
  UPDATE_LOCK_TTL_MS,
} from '../update/lock.js';
import {
  cleanDownloads,
  downloadAsset,
  downloadPath,
  installInfo,
  launchUpdater,
  stageUpdater,
  verifyDownload,
} from '../update/install.js';
import { trayRequested } from './tray.js';

/**
 * API dell'aggiornamento.
 *
 * Il pulsante "Aggiorna ora" risponde subito `202` e il lavoro continua per conto suo: la UI
 * segue da `GET /progress`. Lo spegnimento non viene mai atteso dentro l'handler che sta
 * servendo la richiesta — è il difetto che ha bloccato Trip Finder per una release intera:
 * `thread.join()` su sé stessi solleva, asyncio si mangiava l'eccezione, e il programma non si
 * spegneva affatto. Da fuori: "aggiornamento fermo al 95%".
 */

export interface UpdateDeps {
  /** Dove vivono lucchetto, diario e download. Iniettabile per i test. */
  stateDir: string;
  /** Chiude il server in modo ordinato. Chiamato FUORI dall'handler. */
  onShutdown: () => void;
  /** Override per i test: evita di parlare con GitHub. */
  check?: (opts?: { force?: boolean }) => Promise<UpdateInfo>;
}

export function createUpdateRouter(deps: UpdateDeps): Router {
  const r = Router();
  const check = deps.check ?? checkForUpdate;

  const requireJson = (req: Request, res: Response): boolean => {
    if (!req.is('application/json')) {
      res.status(415).json({ error: 'Content-Type application/json richiesto' });
      return true;
    }
    return false;
  };

  r.get('/check', async (req, res) => {
    const force = req.query.force === '1';
    if (force) resetCheckCache();
    res.json(await check({ force }));
  });

  /**
   * A che punto siamo.
   *
   * `busy` non è "esiste un evento": è "l'ultimo evento non è terminale **e** il lucchetto è
   * vivo". Senza la seconda condizione, dopo un aggiornamento riuscito l'endpoint resterebbe a
   * dire "riavvio, 95%" per sempre, che è esattamente il bug latente di Job Finder.
   */
  r.get('/progress', (_req, res) => {
    const ev = lastEvent(deps.stateDir);
    const lock = readLock(deps.stateDir);
    const terminal = !ev || ev.step === 'done' || ev.step === 'error';
    res.json({
      step: ev?.step ?? 'idle',
      pct: ev?.pct ?? 0,
      detail: ev?.detail ?? null,
      ts: ev?.ts ?? null,
      busy: !terminal && lock !== null && !lock.stale,
    });
  });

  /** Sblocca un aggiornamento rimasto appeso. La usa la UI quando il diario dice `error`. */
  r.delete('/lock', (_req, res) => {
    releaseLock(deps.stateDir);
    res.json({ ok: true });
  });

  r.post('/install', async (req, res) => {
    if (requireJson(req, res)) return;

    const info = await check({ force: true });
    if (!info.frozen) {
      return res.status(409).json({
        error: 'source_install',
        detail: 'Installazione dai sorgenti: aggiorna con `git pull` e `npm install`.',
      });
    }
    if (!info.updateAvailable || !info.asset || !info.latest) {
      return res
        .status(409)
        .json({ error: 'no_update', detail: info.detail ?? 'Sei già alla versione più recente.' });
    }

    const existing = readLock(deps.stateDir);
    if (existing && !existing.stale) {
      return res.status(409).json({
        error: 'update_in_progress',
        detail: 'Un aggiornamento è già in corso.',
        lockAgeMs: existing.age,
        lockTtlMs: UPDATE_LOCK_TTL_MS,
      });
    }
    if (!acquireLock(deps.stateDir, info.latest)) {
      return res.status(409).json({ error: 'update_in_progress' });
    }

    const { root, nodeExe } = installInfo();
    if (!nodeExe) {
      releaseLock(deps.stateDir);
      return res.status(500).json({ error: 'node_exe_missing' });
    }

    res.status(202).json({ started: true, version: info.latest });

    // Da qui in poi il browser non aspetta più: segue da /progress.
    void (async () => {
      const stopHeartbeat = startHeartbeat(deps.stateDir, info.latest ?? '');
      try {
        await cleanDownloads(deps.stateDir);
        const zip = downloadPath(deps.stateDir, info.latest ?? 'nuova');

        writeEvent(deps.stateDir, { step: 'download', pct: 5, detail: 'scarico il bundle' });
        let lastPct = 5;
        await downloadAsset(info.asset!, zip, (received, total) => {
          const pct = total > 0 ? 5 + Math.round((received / total) * 45) : 5;
          if (pct !== lastPct) {
            lastPct = pct;
            writeEvent(deps.stateDir, {
              step: 'download',
              pct,
              detail: `${(received / 1048576).toFixed(1)} MB di ${(total / 1048576).toFixed(1)} MB`,
            });
          }
        });

        writeEvent(deps.stateDir, { step: 'verify', pct: 55, detail: 'verifico il download' });
        await verifyDownload(zip, info.asset!);

        writeEvent(deps.stateDir, { step: 'verify', pct: 65, detail: 'preparo l\'aggiornatore' });
        const tempDir = await stageUpdater(root, nodeExe);

        launchUpdater({
          installRoot: root,
          zipPath: zip,
          tempDir,
          stateDir: deps.stateDir,
          version: info.latest ?? '',
          // Chi è partito con l'icona nella tray deve ritrovarsela dopo il riavvio: `--open` no,
          // perché la scheda del browser è già aperta e si sta ricaricando da sola.
          relaunchArgs: trayRequested() ? ['--tray'] : [],
        });

        stopHeartbeat();
        // Lo spegnimento arriva dopo un attimo: la risposta `202` deve avere il tempo di uscire,
        // e l'aggiornatore quello di mettersi in ascolto del nostro PID.
        setTimeout(() => deps.onShutdown(), 600);
      } catch (e) {
        stopHeartbeat();
        const msg = e instanceof Error ? e.message : String(e);
        writeEvent(deps.stateDir, { step: 'error', pct: 0, detail: msg });
        releaseLock(deps.stateDir);
      }
    })();
  });

  return r;
}
