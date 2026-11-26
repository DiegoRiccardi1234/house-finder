import 'dotenv/config';
import { loginToFacebook } from '../src/sources/fb-login.js';
import { FB_STATE_PATH } from '../src/config/facebook.js';

/**
 * Login FB una-tantum da riga di comando: apre un browser vero, tu logghi a mano (2FA compreso),
 * la sessione finisce in FB_STATE_PATH (gitignorato). Poi: npm run fb:run.
 * Il browser usa un profilo che resta su disco (FB_PROFILE_DIR, default `state/fb-browser-profile/`):
 * la verifica del dispositivo di Facebook si fa una volta sola.
 *
 * La stessa cosa si fa dalla UI con "Accedi da qui" in Config → Facebook, che è la via
 * pensata per chi usa il bundle. Questo resta per lo sviluppo; la logica è condivisa
 * (`src/sources/fb-login.ts`), così i due non divergono.
 */
try {
  const id = await loginToFacebook((line) => console.log(line));
  console.log(`\n✅ Sessione salvata in ${FB_STATE_PATH}${id ? ` (account ${id})` : ''}. Ora: npm run fb:run\n`);
} catch (e) {
  console.error(`\n❌ ${(e as Error).message}\n`);
  process.exit(1);
}
