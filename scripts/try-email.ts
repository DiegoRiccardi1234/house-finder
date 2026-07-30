import 'dotenv/config';
import { Mailbox } from '../src/sources/email/imap.js';
import { emailSources } from '../src/sources/email/index.js';

// Diagnostica: legge le mail non lette e stampa gli annunci estratti.
// NON marca le mail come lette (così puoi ritestare).
if (!Mailbox.configured()) {
  console.error('IMAP non configurato: imposta IMAP_USER e IMAP_PASS in .env');
  process.exit(1);
}

const box = new Mailbox();
await box.open();
try {
  const msgs = await box.fetchUnread();
  console.log(`Mail non lette: ${msgs.length}\n`);
  for (const msg of msgs) {
    const src = emailSources.find((s) => s.matchesSender(msg.from));
    const listings = src ? src.parse(msg.html, msg.text) : [];
    console.log(`— da: ${msg.from} | oggetto: ${msg.subject}`);
    console.log(`  portale: ${src?.name ?? '(non riconosciuto)'} | annunci: ${listings.length}`);
    console.log(JSON.stringify(listings.slice(0, 5), null, 2));
  }
} finally {
  await box.close();
}
