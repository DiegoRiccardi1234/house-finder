import 'dotenv/config';
import { ListingStore } from '../src/core/store.js';
import { createApp } from '../src/server/app.js';

const PORT = Number(process.env.PORT ?? '3000');

async function main(): Promise<void> {
  const store = await ListingStore.load();
  const app = createApp({ store });
  // Bind SOLO su localhost: niente esposizione sulla LAN (nessuna auth su reset/config).
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`🏠 House Finder — server su http://localhost:${PORT}`);
    console.log(`   Archivio: ${store.size} annunci. Dev UI: npm run ui:dev (Vite :5173).`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
