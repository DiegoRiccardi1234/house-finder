import 'dotenv/config';
import { launchBrowser, newContext } from '../src/core/browser.js';
import { isLoggedIn } from '../src/sources/fb-session.js';
import { FB_STATE_PATH } from '../src/config/facebook.js';

/**
 * Login FB una-tantum: apre un browser vero, tu logghi a mano col tuo account, lo script
 * rileva la sessione e la salva in FB_STATE_PATH (gitignorato). Poi: npm run fb:run.
 *
 * Se hai il 2FA attivo questa via chiede il codice a ogni scadenza: in quel caso conviene
 * `npm run fb:from-brave`, che riusa la sessione già aperta nel tuo browser.
 */
const browser = await launchBrowser(); // headed di default (vedi browser.ts)
const ctx = await newContext(browser);
const page = await ctx.newPage();
await page.goto('https://www.facebook.com/login', { waitUntil: 'domcontentloaded' });

console.log('\n👉 Logga a mano nel browser aperto. Attendo il login (max 5 min)...\n');

const deadline = Date.now() + 5 * 60_000;
let ok = false;
while (Date.now() < deadline) {
  if (await isLoggedIn(ctx)) {
    ok = true;
    break;
  }
  await page.waitForTimeout(2000);
}

if (!ok) {
  console.error('❌ Timeout: login non rilevato. Riprova: npm run fb:login');
  await browser.close();
  process.exit(1);
}

await ctx.storageState({ path: FB_STATE_PATH });
console.log(`\n✅ Sessione salvata in ${FB_STATE_PATH}. Ora: npm run fb:run\n`);
await browser.close();
