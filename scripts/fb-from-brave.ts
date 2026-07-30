import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { FB_STATE_PATH } from '../src/config/facebook.js';

/**
 * Crea/rinfresca la sessione Facebook a partire dal profilo Brave dove sei GIÀ loggato,
 * senza login né 2FA. Salva SOLO i cookie di Facebook in state/fb-state.json.
 *
 * PREREQUISITO: Brave completamente CHIUSO (il profilo è lockato quando è aperto).
 * Path override via env BRAVE_USER_DATA / BRAVE_EXE / BRAVE_PROFILE (default: Default).
 *
 * Uso: npm run fb:from-brave
 */
const LOCALAPPDATA = process.env.LOCALAPPDATA ?? '';
const USER_DATA = process.env.BRAVE_USER_DATA ?? `${LOCALAPPDATA}\\BraveSoftware\\Brave-Browser\\User Data`;
const EXE = process.env.BRAVE_EXE ?? 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const PROFILE = process.env.BRAVE_PROFILE ?? 'Default';

async function main(): Promise<void> {
  const ctx = await chromium.launchPersistentContext(USER_DATA, {
    executablePath: EXE,
    headless: true,
    args: [`--profile-directory=${PROFILE}`],
  });
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(2500);

    const state = await ctx.storageState();
    const cookies = state.cookies.filter((c) => /(^|\.)facebook\.com$/.test(c.domain) || /fbcdn/.test(c.domain));
    const origins = (state.origins ?? []).filter((o) => /facebook\.com/.test(o.origin));
    const cUser = cookies.find((c) => c.name === 'c_user');

    if (!cUser) {
      console.error('❌ Nessun cookie c_user: non risulti loggato su FB nel profilo Brave', PROFILE);
      console.error('   (Brave deve essere chiuso; controlla di essere loggato su facebook.com in quel profilo.)');
      process.exit(3);
    }

    mkdirSync(dirname(FB_STATE_PATH), { recursive: true });
    writeFileSync(FB_STATE_PATH, JSON.stringify({ cookies, origins }, null, 2), 'utf8');
    console.log(`✅ Sessione FB salvata in ${FB_STATE_PATH} (${cookies.length} cookie, account id ${cUser.value}).`);
    console.log('   Ora: npm run fb:run');
  } finally {
    await ctx.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
