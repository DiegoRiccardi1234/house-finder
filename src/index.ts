import 'dotenv/config';
import { ListingStore } from './core/store.js';
import { runPipeline, type ChannelId } from './core/pipeline.js';
import { sendListing } from './notify/telegram.js';

// Wrapper CLI del motore (email + scraper opzionali). La logica sta in `src/core/pipeline.ts`.
// Flag:
// - NOTIFY_TELEGRAM=1 → manda su Telegram i nuovi (default OFF: l'output è la Web UI).
// - DRY_RUN=1         → non notifica, solo log.
// - primo run vuoto   → seed: memorizza senza notificare.
// - MAX_NOTIFY        → tetto notifiche/run (default 25).
// - MIN_SCORE         → non notifica i voti AI sotto questa soglia (default 0).
// - ENABLE_SCRAPERS=1 → aggiunge gli scraper headed Subito+Immobiliare (solo PC).
const NOTIFY = process.env.NOTIFY_TELEGRAM === '1';
const DRY_RUN = process.env.DRY_RUN === '1';
const MAX_NOTIFY = Number(process.env.MAX_NOTIFY ?? '25');
const MIN_SCORE = Number(process.env.MIN_SCORE ?? '0');
const ENABLE_SCRAPERS = process.env.ENABLE_SCRAPERS === '1';

const LABELS: Record<ChannelId, string> = {
  email: 'Email',
  subito: 'Subito',
  immobiliare: 'Immobiliare',
  idealista: 'Idealista',
  facebook: 'Facebook',
};

async function main(): Promise<void> {
  const store = await ListingStore.load();
  const seedMode = store.size === 0;
  if (seedMode) console.log('⚙️  Primo run (archivio vuoto): memorizzo senza notificare.');

  const channels: ChannelId[] = ['email'];
  if (ENABLE_SCRAPERS) channels.push('subito', 'immobiliare');

  const summary = await runPipeline(channels, { store });

  if (NOTIFY && !DRY_RUN && !seedMode) {
    let notified = 0;
    for (const r of summary.results) {
      for (const rec of r.newRecords) {
        if (notified >= MAX_NOTIFY) break;
        if (rec.ai && rec.ai.score < MIN_SCORE) continue;
        await sendListing(LABELS[rec.channel as ChannelId] ?? rec.channel, rec.listing, rec.ai ?? undefined);
        notified++;
      }
    }
    console.log(`Notificati: ${notified}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
