import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Il diario dell'aggiornamento, una riga JSON per evento.
 *
 * Lo scrivono due processi diversi — l'app fino allo spegnimento, poi l'aggiornatore — quindi
 * deve essere un file in append e non uno stato in memoria. La UI lo legge da
 * `GET /api/update/progress` per muovere la barra.
 *
 * Job Finder ha lo stesso meccanismo ma **senza uno stato terminale**: la sua mappa si ferma a
 * `restart_spawned → 95%`, e siccome il log è in append, dopo *ogni* aggiornamento riuscito
 * l'endpoint continua a dire "riavvio, 95%" per sempre. Qui esistono `done` e `error`, ed è
 * quello che permette di distinguere "in corso" da "finito ieri".
 */

export type UpdateStep = 'download' | 'verify' | 'replace' | 'restart' | 'done' | 'error';

export interface UpdateEvent {
  ts: number;
  step: UpdateStep;
  /** 0-100. Serve solo alla barra: la verità è `step`. */
  pct: number;
  detail?: string;
}

export const TERMINAL: readonly UpdateStep[] = ['done', 'error'];

export function eventsPath(stateDir: string): string {
  return join(stateDir, 'logs', 'updater.log');
}

/** Oltre questa soglia il diario riparte: è diagnostica, non un archivio. */
const MAX_LOG_BYTES = 256 * 1024;

export function writeEvent(stateDir: string, ev: Omit<UpdateEvent, 'ts'>): void {
  const file = eventsPath(stateDir);
  try {
    mkdirSync(dirname(file), { recursive: true });
    try {
      if (statSync(file).size > MAX_LOG_BYTES) writeFileSync(file, '', 'utf8');
    } catch {
      // Non esiste ancora: la append lo crea.
    }
    appendFileSync(file, JSON.stringify({ ts: Date.now(), ...ev }) + '\n', 'utf8');
  } catch {
    // Il diario è diagnostica: se non si riesce a scrivere, l'aggiornamento continua lo stesso.
  }
}

/** L'ultimo evento scritto, o `null` se non c'è ancora un diario. */
export function lastEvent(stateDir: string): UpdateEvent | null {
  let raw: string;
  try {
    raw = readFileSync(eventsPath(stateDir), 'utf8');
  } catch {
    return null;
  }
  const lines = raw.trimEnd().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (!line) continue;
    try {
      const ev = JSON.parse(line) as UpdateEvent;
      if (typeof ev.step === 'string') return ev;
    } catch {
      // Riga tronca (l'aggiornatore è stato ucciso a metà scrittura): si guarda quella prima.
    }
  }
  return null;
}
