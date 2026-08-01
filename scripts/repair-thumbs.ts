import 'dotenv/config';
import { ListingStore } from '../src/core/store.js';
import { cacheThumb, isCachedThumb, thumbFilePath } from '../src/core/thumbs.js';
import { normalizeImageUrl } from '../src/core/img-fetch.js';
import { existsSync } from 'node:fs';

/**
 * Ripara le miniature già in archivio (one-shot, `npm run fix:thumbs`).
 *
 * Serve per gli annunci salvati prima della cache locale: gli URL Subito senza `?rule=` danno
 * 400 e quelli Facebook scadono in pochi giorni. Chi si può ancora scaricare finisce in cache;
 * chi non risponde più viene azzerato, così la card mostra il placeholder "senza foto" invece
 * di un riquadro rotto.
 *
 * **Da lanciare a server fermo**: col server acceso il primo salvataggio successivo riscrive
 * l'archivio con la versione che ha in memoria e butta via queste modifiche.
 *
 * Opzioni: `--dry` mostra cosa farebbe senza scrivere niente.
 */

const CONCURRENCY = 4;
const dry = process.argv.includes('--dry');

type Outcome = 'ok' | 'repaired' | 'cleared' | 'none';

async function repairOne(rec: { listing: { thumb?: string | null }; photos: string[] }): Promise<Outcome> {
  const current = rec.photos[0];
  if (isCachedThumb(current) && existsSync(thumbFilePath(current) ?? '')) return 'ok';

  const remote = rec.listing.thumb || (current && !isCachedThumb(current) ? current : null);
  if (!remote) {
    if (!dry) rec.photos = [];
    return 'none';
  }

  const url = normalizeImageUrl(remote);
  const local = dry ? null : await cacheThumb(url);
  if (local) {
    rec.photos = [local];
    rec.listing.thumb = url; // l'URL riparato: se un giorno la cache sparisce, almeno è servibile
    return 'repaired';
  }
  if (dry) {
    // In dry-run non scarichiamo: diciamo solo che ci proveremmo.
    return 'repaired';
  }
  rec.photos = [];
  rec.listing.thumb = null;
  return 'cleared';
}

async function main(): Promise<void> {
  const store = await ListingStore.load();
  const all = store.all();
  console.log(`Archivio: ${all.length} annunci${dry ? ' · DRY RUN (nessuna scrittura)' : ''}`);

  const counts: Record<Outcome, number> = { ok: 0, repaired: 0, cleared: 0, none: 0 };
  let next = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const i = next++;
      if (i >= all.length) return;
      const rec = all[i];
      counts[await repairOne(rec)]++;
      if ((counts.ok + counts.repaired + counts.cleared + counts.none) % 25 === 0) {
        console.log(`  …${counts.ok + counts.repaired + counts.cleared + counts.none}/${all.length}`);
      }
    }
  });
  await Promise.all(workers);

  if (!dry) await store.save();

  console.log(
    [
      '',
      `già in cache : ${counts.ok}`,
      `riparate     : ${counts.repaired}`,
      `azzerate     : ${counts.cleared} (URL scaduto/non più servito → placeholder)`,
      `senza foto   : ${counts.none}`,
      dry ? '\nDry run: archivio NON modificato.' : '\nArchivio salvato.',
    ].join('\n'),
  );
}

main().catch((e) => {
  console.error(`repair-thumbs fallito: ${(e as Error).message}`);
  process.exitCode = 1;
});
