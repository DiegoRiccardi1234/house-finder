import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Screenshot pubblici: fixture inventate in TEMP, nessuna scansione o credenziale reale.
 * Prima serve la UI compilata: npm run ui:build. Browser visibile per default.
 */
async function main(): Promise<void> {
  const temp = mkdtempSync(join(tmpdir(), 'hf-docs-'));
  const dataDir = join(temp, 'data');
  const stateDir = join(temp, 'state');
  mkdirSync(join(dataDir, 'local'), { recursive: true });
  mkdirSync(stateDir);
  // Nessun fallback privato dall'ambiente, prima degli import della configurazione.
  for (const key of Object.keys(process.env)) {
    if (/API_KEY|TOKEN|PASS|IMAP_|OPENAI_|OPENROUTER_|GROQ_|ANTHROPIC_|GEMINI_|MODEL|AI_PROVIDER|CUSTOM_BASE_URL|HOUSE_FINDER_/i.test(key)) delete process.env[key];
  }
  Object.assign(process.env, {
    DATA_DIR: dataDir, STATE_DIR: stateDir, LISTINGS_PATH: join(stateDir, 'listings.json'),
    FB_STATE_PATH: join(stateDir, 'fb-state.json'), THUMBS_DIR: join(stateDir, 'thumbs'),
  });
  const searches = [
    { id: 'firenze-demo', city: 'firenze', label: 'Bilocale a Firenze', maxPrice: 950, minRooms: 2, maxRooms: 2 },
    { id: 'padova-demo', city: 'padova', label: 'Bilocale a Padova', maxPrice: 850, minRooms: 2, maxRooms: 2 },
  ];
  const writeFixture = (file: string, value: unknown) => writeFileSync(join(dataDir, 'local', file), JSON.stringify(value, null, 2));
  writeFixture('profile.json', { searches, zones: [], musts: ['Arredato'], notes: '' });
  writeFixture('searches.json', searches);
  writeFixture('facebook.json', { groups: [], marketplace: [] });
  writeFileSync(join(dataDir, 'local', 'criteria.md'), '# Ricerca di esempio\nBilocale arredato a Firenze oppure Padova.\n');
  writeFixture('providers.json', { keys: {} });
  writeFixture('mail.json', {});

  // Riusa solo le immagini locali del demo, mai i vecchi quartieri o giudizi.
  const original = readFileSync('state/listings.demo.json');
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const originalHash = hash(original);
  const source = Object.values(JSON.parse(original.toString('utf8'))) as Array<{ listing: { thumb?: string } }>;
  const records = Object.fromEntries(source.map((record, i) => {
    const city = i % 2 === 0 ? 'Firenze' : 'Padova';
    const sourceName = ['immobiliare', 'idealista', 'subito'][i % 3];
    const key = `${sourceName}:example-${i + 1}`;
    const price = 650 + (i % 6) * 40;
    const thumb = record.listing.thumb?.startsWith('/demo/') ? record.listing.thumb : undefined;
    const title = `Bilocale arredato a ${city} · esempio ${i + 1}`;
    return [key, {
      key, listing: { source: sourceName, id: `example-${i + 1}`, url: `https://example.invalid/annunci/${i + 1}`,
        title, price, rooms: 2, sizeSqm: 50 + (i % 4) * 5, zone: city, thumb,
        desc: 'Annuncio inventato per illustrare la dashboard. Appartamento arredato con soggiorno e cucina.' },
      ai: { score: 90 - i * 3, verdict: 'Valutazione di esempio: budget compatibile e due locali.',
        pros: ['Arredato', 'Due locali', 'Prezzo entro il budget'], cons: ['Spese da verificare'], worthVisit: i < 5 },
      fields: { citta: city, zona: '', tipologia: 'bilocale', prezzo: price, m2: 50 + (i % 4) * 5,
        locali: 2, bagni: 1, arredato: 'sì', contatto: 'privato', vincoli_inquilino: [], riassunto: title },
      photos: thumb ? [thumb] : [], channel: 'email', firstSeen: '2026-09-28T08:00:00.000Z',
      lastSeen: '2026-10-01T08:00:00.000Z', status: i === 0 ? 'favorite' : 'new', notified: false,
    }];
  }));
  writeFileSync(process.env.LISTINGS_PATH!, JSON.stringify(records));

  // Guardia server: nessun endpoint può usare la rete esterna, neanche per la health AI.
  const localFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return Promise.reject(new Error('Screenshot: rete esterna disabilitata'));
    return localFetch(input, init);
  };
  const { ListingStore } = await import('../src/core/store.js');
  const { createApp } = await import('../src/server/app.js');
  const { APP_VERSION } = await import('../src/version.js');
  const store = await ListingStore.load();
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = createApp({ store, stateDir,
      runPipeline: async () => { throw new Error('Screenshot: scansione disabilitata'); },
      checkUpdate: async () => ({ current: APP_VERSION, latest: null, updateAvailable: false,
        releaseUrl: null, notes: '', asset: null, checked: false, frozen: false, detail: 'Esempio offline' }),
    }).listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as { port: number };
  const base = `http://127.0.0.1:${port}`;
  mkdirSync('docs', { recursive: true });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ headless: process.env.DOCS_HEADLESS === '1', channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 1, colorScheme: 'light' });
    page.on('pageerror', (error) => console.error(`UI: ${error.message}`));
    page.on('response', (response) => { if (response.status() >= 400) console.error(`HTTP ${response.status()}: ${new URL(response.url()).pathname}`); });
    await page.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    page.setDefaultTimeout(15_000);
    const shot = async (name: string, fullPage = false) => {
      await page.evaluate(async () => {
        await document.fonts.ready;
        for (const img of Array.from(document.images)) img.loading = 'eager';
        await Promise.all(Array.from(document.images).map((img) => img.complete ? Promise.resolve() : new Promise<void>((resolve) => {
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        })));
      });
      await page.screenshot({ path: join('docs', `${name}.png`), scale: 'css', fullPage, animations: 'disabled' });
      console.log(`✓ docs/${name}.png`);
    };
    const tab = (name: string) => page.getByRole('tab', { name, exact: true }).click();
    await page.goto(base, { waitUntil: 'networkidle' });
    console.log(`Pagina caricata: ${await page.title()} · ${(await page.locator('body').innerText()).slice(0, 160)}`);
    // Un profilo vuoto può deviare su Config: seleziona esplicitamente Annunci.
    await tab('Annunci');
    await page.getByRole('link', { name: 'Bilocale arredato a Firenze · esempio 1', exact: true }).waitFor();
    await page.locator('img').first().waitFor({ state: 'visible' });
    await shot('dashboard');
    await tab('Cerca');
    await page.getByRole('button', { name: 'Cerca adesso', exact: true }).waitFor();
    await page.getByRole('checkbox').first().waitFor();
    await shot('run');
    await tab('Profilo');
    await page.getByText('Firenze · Padova', { exact: true }).waitFor();
    await page.getByText('Nessun provider AI', { exact: true }).waitFor();
    await page.getByText('annunci trovati', { exact: true }).waitFor();
    await shot('profile', true);
    await tab('Config');
    await tab('La tua ricerca');
    await page.getByRole('heading', { name: 'Città, tipo di casa e budget', exact: true }).waitFor();
    await page.getByRole('spinbutton').first().waitFor();
    await page.locator('textarea').first().fill('Bilocale arredato a Firenze o Padova, entro il budget indicato.');
    await shot('config');
    await page.getByRole('tab', { name: /^Provider AI/ }).click();
    await page.getByText('Nessun provider AI configurato', { exact: true }).locator('visible=true').first().waitFor();
    await page.getByText('OpenRouter', { exact: true }).locator('visible=true').first().waitFor();
    await shot('providers');
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    store.close();
    globalThis.fetch = localFetch;
    if (hash(readFileSync('state/listings.demo.json')) !== originalHash) throw new Error('Il demo originale è stato modificato');
    console.log(`Demo originale invariato: ${originalHash}`);
  }
}

main().catch((e) => {
  console.error(`shoot-docs fallito: ${(e as Error).message}`);
  process.exitCode = 1;
});
