import 'dotenv/config';
import { scoreBatch, configured } from '../src/ai/score.js';
import { dedupKey } from '../src/core/state.js';
import type { Listing } from '../src/core/types.js';

if (!configured()) {
  console.error('OPENROUTER_API_KEY mancante in .env');
  process.exit(1);
}

const sample: Listing[] = [
  { source: 'immobiliare', id: '111', url: 'https://www.immobiliare.it/annunci/111/', title: 'Bilocale luminoso zona San Salvario, Torino', price: 650, rooms: 2, sizeSqm: 55, zone: 'San Salvario' },
  { source: 'idealista', id: '222', url: 'https://www.idealista.it/immobili/222/', title: 'Monolocale seminterrato periferia', price: 900, rooms: 1, sizeSqm: 30, zone: null },
];

const scores = await scoreBatch(sample);
for (const l of sample) {
  console.log(`\n=== ${l.title} ===`);
  console.log(JSON.stringify(scores.get(dedupKey(l)) ?? '(nessun voto)', null, 2));
}
