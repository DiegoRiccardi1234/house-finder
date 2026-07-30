import 'dotenv/config';
import { existsSync } from 'node:fs';
import { ListingStore } from '../src/core/store.js';
import { runPipeline } from '../src/core/pipeline.js';
import { sendListing } from '../src/notify/telegram.js';
import { FB_STATE_PATH } from '../src/config/facebook.js';

/**
 * Wrapper CLI Facebook (solo PC, schedulato 13:00 e 21:00). La logica sta in `src/core/pipeline.ts`.
 * Flag: NOTIFY_TELEGRAM=1 (default OFF, output = Web UI), DRY_RUN=1, MIN_SCORE, MAX_NOTIFY.
 * Primo run (archivio vuoto) = seed silenzioso.
 */
const NOTIFY = process.env.NOTIFY_TELEGRAM === '1';
const DRY_RUN = process.env.DRY_RUN === '1';
const MAX_NOTIFY = Number(process.env.MAX_NOTIFY ?? '25');
const MIN_SCORE = Number(process.env.MIN_SCORE ?? '0');

async function main(): Promise<void> {
  if (!existsSync(FB_STATE_PATH)) {
    console.error(`❌ Sessione FB assente (${FB_STATE_PATH}). Lancia prima: npm run fb:login`);
    process.exit(1);
  }

  const store = await ListingStore.load();
  const seedMode = store.size === 0;
  if (seedMode) console.log('⚙️  Primo run (archivio vuoto): memorizzo senza notificare.');

  const summary = await runPipeline(['facebook'], { store });

  let notified = 0;
  if (NOTIFY && !DRY_RUN && !seedMode) {
    for (const rec of summary.results.flatMap((r) => r.newRecords)) {
      if (notified >= MAX_NOTIFY) break;
      if (rec.ai && rec.ai.score < MIN_SCORE) continue;
      await sendListing('Facebook', rec.listing, rec.ai ?? undefined);
      notified++;
    }
  }
  console.log(`✅ FB fine. Notificati: ${notified} · in archivio: ${store.size}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
