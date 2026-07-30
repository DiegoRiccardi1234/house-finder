import 'dotenv/config';
import { sendText } from '../src/notify/telegram.js';

await sendText('✅ House Finder: test notifica riuscito. Il bot funziona.');
console.log('Messaggio inviato. Controlla Telegram.');
