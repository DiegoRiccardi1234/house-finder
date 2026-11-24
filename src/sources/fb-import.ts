import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { FB_STATE_PATH } from '../config/facebook.js';

/**
 * Sessione Facebook presa dal profilo Brave in cui la persona è GIÀ dentro: niente login, niente
 * verifica. È la via che funziona quando Facebook chiede una verifica a ogni accesso dalla finestra
 * dell'app: quella finestra è un profilo nuovo e automatizzato, il Brave di tutti i giorni no.
 *
 * Solo Brave e non Chrome: Chrome cifra i cookie legandoli al proprio eseguibile (app-bound
 * encryption) e un altro programma non li può leggere. Brave va chiuso: col browser aperto il
 * profilo è bloccato. Salva soltanto i cookie di Facebook.
 */

export interface BravePaths { userData: string; exe: string; profile: string }

export function bravePaths(env: NodeJS.ProcessEnv = process.env): BravePaths {
  const local = env.LOCALAPPDATA ?? '';
  return {
    userData: env.BRAVE_USER_DATA ?? join(local, 'BraveSoftware', 'Brave-Browser', 'User Data'),
    exe: env.BRAVE_EXE ?? 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    profile: env.BRAVE_PROFILE ?? 'Default',
  };
}

/** Brave installato con un profilo: decide se mostrare il pulsante. */
export function braveAvailable(paths: BravePaths = bravePaths()): boolean {
  return existsSync(paths.exe) && existsSync(join(paths.userData, paths.profile));
}

export async function importFacebookFromBrave(
  log: (line: string) => void,
  opts: { statePath?: string; paths?: BravePaths } = {},
): Promise<string> {
  const paths = opts.paths ?? bravePaths();
  const statePath = opts.statePath ?? FB_STATE_PATH;
  if (!braveAvailable(paths)) throw new Error('Brave non trovato su questo computer.');

  log('Leggo la sessione di Facebook dal profilo di Brave…');
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(paths.userData, {
      executablePath: paths.exe,
      headless: true,
      args: [`--profile-directory=${paths.profile}`],
    });
  } catch {
    // In pratica quasi sempre: profilo bloccato da un Brave ancora aperto (anche solo nell'area di notifica).
    throw new Error('Non riesco ad aprire il profilo di Brave: chiudi Brave del tutto (anche dall\'area di notifica) e riprova.');
  }
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(2500);

    const state = await ctx.storageState();
    const cookies = state.cookies.filter((c) => /(^|\.)facebook\.com$/.test(c.domain) || /fbcdn/.test(c.domain));
    const origins = (state.origins ?? []).filter((o) => /facebook\.com/.test(o.origin));
    const cUser = cookies.find((c) => c.name === 'c_user');
    if (!cUser) throw new Error('In Brave non risulti dentro Facebook: accedi a facebook.com da Brave, chiudilo e riprova.');

    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify({ cookies, origins }, null, 2), 'utf8');
    log(`Sessione salvata (${cookies.length} cookie).`);
    return cUser.value;
  } finally {
    await ctx.close().catch(() => {});
  }
}
