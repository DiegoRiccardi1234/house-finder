import type { Page } from 'playwright';

/**
 * Facebook carica e virtualizza il feed anche quando l'altezza della pagina non cresce.
 * Raccogli durante l'attesa: evita di perdere card che appaiono e scompaiono nello stesso scroll.
 */
export async function settleFacebookContent(page: Page, collect: () => Promise<number>): Promise<void> {
  const started = Date.now();
  let lastChange = started;
  let previous = -1;
  do {
    const count = await collect();
    const now = Date.now();
    if (count !== previous) {
      previous = count;
      lastChange = now;
    }
    // Almeno 5 secondi dopo ogni navigazione/scroll, fino a 12 se arrivano nuovi elementi.
    if (now - started >= 5000 && now - lastChange >= 2000) break;
    await page.waitForTimeout(500);
  } while (Date.now() - started < 12_000);
  await collect();
}
