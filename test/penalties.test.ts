import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearPenalties,
  penaltyScore,
  recordPenalty,
  setPenaltyClock,
} from '../src/ai/endpoint-health.js';

const MIN = 60_000;

/** Orologio finto: i cooldown durano fino a un'ora, i test non possono aspettarla. */
function withClock(fn: (advance: (ms: number) => void) => void): void {
  let t = 1_000_000;
  setPenaltyClock(() => t);
  clearPenalties();
  try {
    fn((ms) => {
      t += ms;
    });
  } finally {
    clearPenalties();
    setPenaltyClock(() => Date.now());
  }
}

test('cooldown: il troncamento è strutturale e dura, il 429 passa', () => {
  withClock((advance) => {
    recordPenalty('openrouter::big', 'length');
    recordPenalty('openrouter::small', '429');

    assert.equal(penaltyScore('openrouter::big'), 3);
    assert.equal(penaltyScore('openrouter::small'), 1);

    advance(6 * MIN); // il throttle è passato
    assert.equal(penaltyScore('openrouter::small'), 0, '429 dovrebbe essere scaduto');
    assert.equal(penaltyScore('openrouter::big'), 3, 'il troncamento no: quel modello tronca ancora');

    advance(30 * MIN); // 36 minuti totali: ancora dentro l'ora
    assert.equal(penaltyScore('openrouter::big'), 3);

    advance(30 * MIN); // oltre l'ora
    assert.equal(penaltyScore('openrouter::big'), 0);
  });
});

test('le penalità si sommano finché sono vive', () => {
  withClock((advance) => {
    recordPenalty('p::m', '429');
    recordPenalty('p::m', 'empty');
    assert.equal(penaltyScore('p::m'), 4); // 1 + 3

    advance(4 * MIN); // empty (3 min) scaduto, 429 (5 min) ancora vivo
    assert.equal(penaltyScore('p::m'), 1);
  });
});

test('la chiave è per coppia provider+modello: host diversi non si contaminano', () => {
  withClock(() => {
    recordPenalty('groq::llama-3.3-70b', 'length');
    assert.equal(penaltyScore('groq::llama-3.3-70b'), 3);
    assert.equal(penaltyScore('cerebras::llama-3.3-70b'), 0);
  });
});

test('clearPenalties(reason) azzera solo quel motivo', () => {
  withClock(() => {
    recordPenalty('p::a', 'length');
    recordPenalty('p::a', '429');
    clearPenalties('length');
    assert.equal(penaltyScore('p::a'), 1, 'doveva restare solo il 429');
  });
});
