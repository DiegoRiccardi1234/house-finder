import { importFacebookFromBrave } from '../src/sources/fb-import.js';
import { FB_STATE_PATH } from '../src/config/facebook.js';

/**
 * Crea/rinfresca la sessione Facebook a partire dal profilo Brave dove sei GIÀ loggato,
 * senza login né 2FA. Salva SOLO i cookie di Facebook in state/fb-state.json.
 *
 * PREREQUISITO: Brave completamente CHIUSO (il profilo è lockato quando è aperto).
 * Path override via env BRAVE_USER_DATA / BRAVE_EXE / BRAVE_PROFILE (default: Default).
 * Dalla UI: Config → Facebook → "Prendi la sessione da un browser" (stessa logica, `src/sources/fb-import.ts`,
 * che sa leggere anche Edge, Vivaldi, Opera e Firefox).
 *
 * Uso: npm run fb:from-brave
 */
try {
  const id = await importFacebookFromBrave((line) => console.log(line));
  console.log(`✅ Sessione FB salvata in ${FB_STATE_PATH} (account id ${id}). Ora: npm run fb:run`);
} catch (e) {
  console.error(`❌ ${(e as Error).message}`);
  process.exit(1);
}
