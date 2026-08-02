import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Il lucchetto dell'aggiornamento: impedisce due aggiornamenti sovrapposti.
 *
 * Job Finder ha due TTL che non concordano — 180 s lato server e 900 s lato launcher — e il
 * commento nel codice ammette il perché: su una linea lenta il download supera il TTL del server,
 * che quindi permette un secondo `Updater.exe` mentre il primo sta ancora copiando. Erano finiti
 * lì perché il lucchetto è scritto una volta sola e poi invecchia da fermo.
 *
 * Qui il lucchetto ha un **battito**: chi sta lavorando lo ritocca ogni pochi secondi. Così un
 * solo TTL basta per tutti, e "scaduto" significa davvero "il processo è morto", non "sta
 * scaricando da parecchio".
 */

export const UPDATE_LOCK_TTL_MS = 120_000;
export const HEARTBEAT_MS = 5_000;

export interface LockState {
  pid: number;
  version: string;
  /** Millisecondi dall'ultimo battito. */
  age: number;
  /** `true` se nessuno lo ritocca da più di `UPDATE_LOCK_TTL_MS`. */
  stale: boolean;
}

export function lockPath(stateDir: string): string {
  return join(stateDir, 'update.lock');
}

export function readLock(stateDir: string): LockState | null {
  const file = lockPath(stateDir);
  let raw: string;
  let mtime: number;
  try {
    raw = readFileSync(file, 'utf8');
    mtime = statSync(file).mtimeMs;
  } catch {
    return null;
  }
  let pid = 0;
  let version = '';
  try {
    const parsed = JSON.parse(raw) as { pid?: unknown; version?: unknown };
    if (typeof parsed.pid === 'number') pid = parsed.pid;
    if (typeof parsed.version === 'string') version = parsed.version;
  } catch {
    // Un lucchetto illeggibile conta comunque come lucchetto: è l'età che decide.
  }
  const age = Date.now() - mtime;
  return { pid, version, age, stale: age > UPDATE_LOCK_TTL_MS };
}

/**
 * Prende il lucchetto. Torna `false` se ce n'è già uno vivo.
 *
 * Un lucchetto scaduto viene scavalcato senza discutere: vorrebbe dire che l'aggiornatore è
 * morto, e restare bloccati per sempre sarebbe peggio del rischio di riprovare.
 */
export function acquireLock(stateDir: string, version: string, pid = process.pid): boolean {
  const existing = readLock(stateDir);
  if (existing && !existing.stale && existing.pid !== pid) return false;
  touchLock(stateDir, version, pid);
  return true;
}

export function touchLock(stateDir: string, version: string, pid = process.pid): void {
  mkdirSync(dirname(lockPath(stateDir)), { recursive: true });
  writeFileSync(lockPath(stateDir), JSON.stringify({ pid, version, at: Date.now() }));
}

export function releaseLock(stateDir: string): void {
  try {
    rmSync(lockPath(stateDir), { force: true });
  } catch {
    // Best-effort: se la cancellazione fallisce ci pensa il TTL.
  }
}

/** Ritocca il lucchetto finché non si chiama la funzione tornata. */
export function startHeartbeat(stateDir: string, version: string, pid = process.pid): () => void {
  const timer = setInterval(() => touchLock(stateDir, version, pid), HEARTBEAT_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
