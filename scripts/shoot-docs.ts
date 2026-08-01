import { chromium } from 'playwright';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Rigenera gli screenshot del README (`docs/*.png`).
 *
 * Due accortezze che non sono dettagli:
 *  - la UI legge `data/local/`, cioè la configurazione VERA (budget, zone, note personali):
 *    qui `DATA_DIR` viene deviato su una copia dei file di esempio, così nelle immagini non
 *    finisce niente di privato;
 *  - `scale: 'css'`. Su Windows con `scale: 'device'` il subpixel rendering colora di
 *    arancio/azzurro il testo mono leggero e sembra un bug del CSS.
 *
 * Prima di lanciarlo serve la UI compilata: `npm run ui:build`.
 */

const VIEWPORT = { width: 1440, height: 980 };
const OUT = 'docs';

async function main(): Promise<void> {
  // Config pubblica finta, mai quella reale.
  const dataDir = mkdtempSync(join(tmpdir(), 'hf-pubdata-'));
  for (const f of ['criteria.md', 'searches.json', 'facebook.json']) copyFileSync(join('data', f), join(dataDir, f));
  // Key finta: serve solo a non far comparire l'avviso "nessun provider AI configurato" in
  // ogni immagine. Non esce mai dal server (l'API restituisce solo `configured`/`keyState`).
  mkdirSync(join(dataDir, 'local'), { recursive: true });
  writeFileSync(
    join(dataDir, 'local', 'providers.json'),
    JSON.stringify({ primary: 'openrouter', keys: { openrouter: 'sk-or-v1-demo-screenshot' } }, null, 2),
  );
  process.env.DATA_DIR = dataDir;
  process.env.LISTINGS_PATH = 'state/listings.demo.json';
  // Idem per IMAP: senza, ogni immagine porta in testa "canale email spento". Nessuna
  // connessione viene aperta: negli screenshot non si lancia nessun run.
  process.env.IMAP_USER ||= 'demo@example.com';
  process.env.IMAP_PASS ||= 'demo';

  // Import DOPO le env: i path di config si risolvono all'avvio del modulo.
  const { ListingStore } = await import('../src/core/store.js');
  const { createApp } = await import('../src/server/app.js');
  const store = await ListingStore.load();
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = createApp({ store }).listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as { port: number };
  const base = `http://127.0.0.1:${port}`;
  console.log(`server di prova su ${base} · ${store.size} annunci demo`);

  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    // `colorScheme` fissato: il tema "sistema" seguirebbe la macchina di chi lancia lo script
    // e le immagini uscirebbero metà chiare e metà scure a seconda del giorno.
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: 'light' });
    const shot = async (name: string, fullPage = false) => {
      await page.waitForTimeout(400); // transizioni del tema/tab
      await page.screenshot({ path: join(OUT, `${name}.png`), scale: 'css', fullPage });
      console.log(`  ✓ ${OUT}/${name}.png`);
    };
    const tab = async (name: string) => {
      await page.getByRole('tab', { name, exact: true }).click();
    };

    await page.goto(base, { waitUntil: 'networkidle' });
    // Le miniature hanno `alt=""` (decorative): niente ruolo `img`, si aspetta il tag.
    await page.locator('img').first().waitFor({ state: 'visible' });
    await shot('dashboard');

    await tab('Cerca');
    await shot('run');

    await tab('Profilo');
    await shot('profile', true);

    await tab('Config');
    await shot('config');

    await tab('Provider AI');
    await shot('providers');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error(`shoot-docs fallito: ${(e as Error).message}`);
  process.exit(1);
});
