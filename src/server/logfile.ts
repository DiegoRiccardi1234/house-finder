import { createWriteStream, mkdirSync, statSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Copia su file tutto quello che va sulla console.
 *
 * Serve da quando l'app può partire **senza finestra** (`HouseFinder.vbs`): con la console
 * nascosta, un errore all'avvio non lo vede nessuno. In Job e Trip Finder è stata la differenza
 * fra "non parte e non so perché" e una riga di log da leggere.
 *
 * La console resta comunque scritta: chi avvia da terminale non deve perdere niente.
 */

const MAX_BYTES = 2 * 1024 * 1024;

export function logPath(stateDir: string): string {
  return join(stateDir, 'logs', 'house-finder.log');
}

/** Ruota il log se è cresciuto troppo: uno solo, non una collezione. */
function rotate(file: string): void {
  try {
    if (statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`);
  } catch {
    // Non esiste ancora, o è in uso: si continua ad appendere.
  }
}

export function teeConsoleToFile(stateDir: string): void {
  const file = logPath(stateDir);
  try {
    mkdirSync(dirname(file), { recursive: true });
    rotate(file);
  } catch {
    return; // Senza cartella non si logga su file, ma il server parte lo stesso.
  }

  const out = createWriteStream(file, { flags: 'a' });
  const stamp = (): string => new Date().toISOString();
  const wrap = (livello: string, originale: (...a: unknown[]) => void) =>
    (...args: unknown[]): void => {
      originale(...args);
      try {
        out.write(`${stamp()} ${livello} ${args.map(String).join(' ')}\n`);
      } catch {
        /* il log non deve mai far cadere ciò che stava loggando */
      }
    };

  console.log = wrap('INFO', console.log.bind(console));
  console.warn = wrap('WARN', console.warn.bind(console));
  console.error = wrap('ERR ', console.error.bind(console));
}
