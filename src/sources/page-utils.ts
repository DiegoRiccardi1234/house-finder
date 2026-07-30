import type { Page } from 'playwright';

/** Naviga in modo tollerante e prova a chiudere i banner cookie. */
export async function gotoResilient(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });

  // Banner cookie: click best-effort, non blocca se non c'è.
  for (const label of ['Accetta tutto', 'Accetta', 'Accetto', 'Consenti', 'Accept', 'OK']) {
    const btn = page.getByRole('button', { name: new RegExp(`^${label}`, 'i') }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click().catch(() => {});
      break;
    }
  }
  await page.waitForTimeout(1500);
}

/**
 * Scrolla fino in fondo e ASPETTA che il contenuto lazy cresca (fino a ~2.5s), invece di
 * scrollare a step fissi "alla cieca". Chiamare più volte per feed lazy (FB): ogni chiamata
 * carica un blocco in più. Ritorna quando l'altezza non cresce più (fine feed) o al timeout.
 */
export async function autoScroll(page: Page): Promise<void> {
  const before = await page.evaluate(() => document.body.scrollHeight);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page
    .waitForFunction((h) => document.body.scrollHeight > (h as number), before, { timeout: 2500 })
    .catch(() => {}); // nessuna crescita = probabile fine feed
  await page.waitForTimeout(400);
}

/** Lanciata quando una pagina mostra un blocco anti-bot (DataDome/Akamai/challenge). */
export class BlockedError extends Error {
  constructor(public host: string) {
    super(`BLOCCATO (anti-bot) su ${host}`);
    this.name = 'BlockedError';
  }
}

const BLOCK_MARKERS = [
  'access denied',
  'accesso negato',
  'accesso bloccato',
  'unusual traffic',
  'are you a robot',
  'verifica di sicurezza',
  'pardon our interruption',
  'datadome',
  'captcha',
];

/**
 * Rileva le pagine di blocco anti-bot e lancia `BlockedError`, così un blocco NON viene
 * confuso con "0 risultati" (che sarebbe silenzioso). Da chiamare dopo il `goto`.
 */
export async function assertNotBlocked(page: Page): Promise<void> {
  const sig = await page.evaluate(() => ({
    title: (document.title || '').toLowerCase(),
    body: (document.body?.innerText || '').slice(0, 800).toLowerCase(),
    url: location.href.toLowerCase(),
  }));
  const hay = `${sig.title} ${sig.body} ${sig.url}`;
  if (BLOCK_MARKERS.some((m) => hay.includes(m))) {
    let host = 'sconosciuto';
    try {
      host = new URL(sig.url).hostname;
    } catch {
      /* url non parsabile */
    }
    throw new BlockedError(host);
  }
}
