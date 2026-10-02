import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

interface Owner { pid: number; token: string }

function live(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; }
  catch (e) { return (e as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

function owner(path: string): Owner {
  const value = JSON.parse(readFileSync(path, 'utf8')) as Owner;
  if (!Number.isInteger(value.pid) || typeof value.token !== 'string') {
    throw new Error('Lucchetto archivio non valido: verifica che tutte le istanze siano chiuse.');
  }
  return value;
}

/** Un solo writer per archivio, anche fra CLI e app. I lettori restano compatibili. */
export function acquireStoreLock(archive: string): () => void {
  const absolute = resolve(archive);
  mkdirSync(dirname(absolute), { recursive: true });
  const path = join(realpathSync(dirname(absolute)), basename(absolute)) + '.lock';
  const token = randomUUID();
  const create = (): void => {
    const fd = openSync(path, 'wx');
    try { writeFileSync(fd, JSON.stringify({ pid: process.pid, token })); }
    finally { closeSync(fd); }
  };
  try { create(); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    // Serializza il recupero di un lock lasciato da un processo morto: due avvii
    // contemporanei non devono cancellarsi a vicenda un lock appena acquisito.
    const reclaim = path + '.reclaim';
    let fd: number;
    try { fd = openSync(reclaim, 'wx'); }
    catch { throw new Error('Archivio già in uso o recupero in corso. Chiudi l’altra istanza.'); }
    try {
      if (existsSync(path)) {
        if (live(owner(path).pid)) throw new Error('Archivio già in uso. Chiudi l’altra istanza.');
        unlinkSync(path);
      }
      create();
    } finally { closeSync(fd); unlinkSync(reclaim); }
  }
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    process.off('exit', release);
    try { if (owner(path).token === token) unlinkSync(path); } catch { /* già rimosso */ }
  };
  process.once('exit', release);
  return release;
}
