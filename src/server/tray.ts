import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * L'icona nell'area di notifica, delegata a PowerShell.
 *
 * Il lavoro vero lo fa `scripts/tray.ps1`: qui si avvia il processo figlio e ci si assicura che
 * muoia con noi. Il percorso dello script è lo stesso in sorgente e nel bundle — `src/server/`
 * sta due livelli sotto la radice in entrambi i casi, perché `tsc` conserva `src/` dentro `app/`.
 *
 * Regola: **un fallimento qui non deve toccare il server**. L'icona è comodità; se PowerShell è
 * bloccato da criteri di sicurezza o WinForms non carica, House Finder deve restare in ascolto
 * come se niente fosse. È lo stesso comportamento di pystray in Job e Trip Finder.
 */

const TRAY_SCRIPT = fileURLToPath(new URL('../../scripts/tray.ps1', import.meta.url));

/** `true` se questo avvio vuole l'icona: la chiede il launcher del bundle, o `--tray` a mano. */
export function trayRequested(argv: readonly string[] = process.argv): boolean {
  return process.env.HOUSE_FINDER_TRAY === '1' || argv.includes('--tray');
}

export interface Tray {
  stop: () => void;
}

export function startTray(url: string): Tray | null {
  if (process.platform !== 'win32') return null;
  if (!existsSync(TRAY_SCRIPT)) return null;

  let child: ChildProcess;
  try {
    child = spawn(
      'powershell',
      [
        '-NoProfile',
        // Senza questo, su una macchina con criteri restrittivi lo script non parte affatto.
        '-ExecutionPolicy',
        'Bypass',
        '-WindowStyle',
        'Hidden',
        '-File',
        TRAY_SCRIPT,
        '-Url',
        url,
        '-ParentPid',
        String(process.pid),
      ],
      { windowsHide: true, stdio: 'ignore' },
    );
  } catch {
    return null;
  }

  child.on('error', () => {
    /* niente PowerShell: si resta senza icona, non senza server */
  });

  const stop = (): void => {
    try {
      child.kill();
    } catch {
      /* già uscito da sé: lo script si spegne quando vede sparire il nostro PID */
    }
  };
  // Cintura in più: lo script ha già la sua guardia sul PID padre, ma se usciamo in modo ordinato
  // è meglio che l'icona sparisca subito invece che al prossimo giro del timer.
  process.once('exit', stop);

  return { stop };
}
