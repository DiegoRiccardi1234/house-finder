import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

/**
 * Installazione di Chromium da un pulsante.
 *
 * I binari dei browser pesano ~400 MB e non stanno nel bundle di release: senza, quattro canali
 * su cinque risultano non disponibili. Finora si risolveva con `install-browsers.bat`, un doppio
 * click che apre una console — e chi lo saltava vedeva metà app spenta senza capire perché.
 *
 * Non si passa da `npx`: il bundle non ha npm. Si invoca la CLI di Playwright direttamente col
 * Node in esecuzione, che nel bundle è `node.exe` accanto all'app e in sviluppo è quello di
 * sistema. In entrambi i casi `node_modules/playwright` c'è, quindi il percorso si risolve da sé.
 */

/** I binari possono mancare anche dopo un `npm install`: `executablePath()` calcola, non verifica. */
export function browsersInstalled(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

function cliPath(): string {
  const require = createRequire(import.meta.url);
  return require.resolve('playwright/cli.js');
}

export async function installBrowsers(log: (line: string) => void): Promise<string> {
  if (browsersInstalled()) return 'I browser erano già installati.';

  let cli: string;
  try {
    cli = cliPath();
  } catch {
    throw new Error(
      'Non trovo la CLI di Playwright in node_modules: installazione incompleta, riscarica il pacchetto.',
    );
  }

  log('Scarico Chromium (~400 MB): può volerci qualche minuto.');
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'install', 'chromium'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Playwright scrive l'avanzamento su stderr: ignorarlo vorrebbe dire una barra muta per minuti.
    const onData = (buf: Buffer): void => {
      for (const line of buf.toString().split(/\r?\n/)) {
        const t = line.trim();
        if (t) log(t);
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', reject);
    child.on('close', (c) => resolve(c ?? 1));
  });

  if (code !== 0) throw new Error(`Installazione non riuscita (codice ${code}).`);
  if (!browsersInstalled()) {
    throw new Error("L'installazione è finita senza errori ma il browser non risulta presente.");
  }
  return 'Chromium installato: i canali Subito, Immobiliare, Idealista e Facebook sono ora disponibili.';
}
