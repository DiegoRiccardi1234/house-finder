import type { BrowserContext } from 'playwright';

/**
 * Loggato su Facebook? Controlla il cookie `c_user` (id utente), presente solo a sessione valida.
 * Usato da fb-login (attesa login) e fb-run (abort se sessione scaduta).
 */
export async function isLoggedIn(ctx: BrowserContext): Promise<boolean> {
  const cookies = await ctx.cookies('https://www.facebook.com');
  return cookies.some((c) => c.name === 'c_user' && !!c.value);
}
