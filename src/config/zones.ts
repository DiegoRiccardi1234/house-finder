import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * I quartieri già pronti per alcune città.
 *
 * Servono a togliere il campo vuoto: aprire la configurazione e trovarsi una casella dove
 * digitare i nomi dei quartieri a memoria è la cosa che ha fatto dire «non ci sto capendo nulla».
 * Dove c'è un elenco, si spunta; dove non c'è, lo propone l'AI (`/api/assist/zones/:city`).
 *
 * Un elenco incluso non potrà mai coprire 109 città: è un acceleratore per le più probabili, non
 * una fonte di verità. Per questo la mancanza non è un errore — è il caso normale.
 */

export interface ZoneSeed {
  city: string;
  zones: string[];
}

const cache = new Map<string, string[]>();

function seedPath(slug: string): string {
  // Nel bundle i dati stanno in `app/data/`, come per criteri e ricerche: stesso `../../data/`
  // che usa `src/config/paths.ts`, così una sola regola vale in sorgente e nel pacchetto.
  return fileURLToPath(new URL(`../../data/zones/${slug}.json`, import.meta.url));
}

/** I quartieri inclusi per una città, o lista vuota se non ce ne sono. Non solleva mai. */
export function loadZoneSeed(slug: string): string[] {
  const key = slug.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  let zones: string[] = [];
  try {
    const raw = JSON.parse(readFileSync(seedPath(key), 'utf8')) as { zones?: unknown };
    if (Array.isArray(raw.zones)) {
      zones = raw.zones.filter((z): z is string => typeof z === 'string' && z.trim().length > 1);
    }
  } catch {
    // Nessun elenco per questa città: è il caso normale, non un guasto.
  }
  cache.set(key, zones);
  return zones;
}

export function invalidateZoneSeeds(): void {
  cache.clear();
}
