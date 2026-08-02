/**
 * La versione dell'app, in un posto solo.
 *
 * Prima viveva solo in `package.json` e `ui/package.json`, copiata a mano e mai leggibile a
 * runtime. Ora la fonte di verità è questa costante: `/api/meta` la espone, il controllo
 * aggiornamenti la confronta con l'ultima release, e `test/version.test.ts` fallisce se una delle
 * copie nei `package.json` resta indietro. Senza quel test la divergenza non si vede finché non
 * esce una release che si annuncia con il numero sbagliato.
 *
 * Al bump vanno aggiornati tutti e tre, più la sezione del CHANGELOG (è il corpo della release).
 */
export const APP_VERSION = '1.6.0';

/** Il repository da cui si scaricano gli aggiornamenti. */
export const GITHUB_REPO = 'DiegoRiccardi1234/house-finder';

/** Il nome dell'asset allegato alle release `v*` dal workflow `release.yml`. */
export const BUNDLE_ASSET = 'HouseFinder-windows.zip';
