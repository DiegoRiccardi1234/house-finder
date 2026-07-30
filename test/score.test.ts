import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScoreResponse } from '../src/ai/score.js';

test('parseScoreResponse: JSON pulito → mappa id→risultato', () => {
  const m = parseScoreResponse('{"scores":[{"id":"a","score":80,"verdict":"ok","worthVisit":true}]}');
  assert.equal(m.size, 1);
  assert.equal(m.get('a')?.ai.score, 80);
  assert.equal(m.get('a')?.ai.worthVisit, true);
});

test('parseScoreResponse: JSON dentro fence + prosa → estratto lo stesso', () => {
  const raw = 'Ecco la valutazione:\n```json\n{"scores":[{"id":"b","score":50}]}\n```\nSpero sia utile.';
  const m = parseScoreResponse(raw);
  assert.equal(m.get('b')?.ai.score, 50);
});

test('parseScoreResponse: item malformati scartati uno a uno, i buoni restano', () => {
  const m = parseScoreResponse('{"scores":[{"id":"c","score":70}, 42, "spazzatura", {"score":10}]}');
  assert.equal(m.size, 1); // 42/"spazzatura" scartati; l'oggetto senza id scartato
  assert.ok(m.get('c'));
});

test('parseScoreResponse: campi mancanti → default tolleranti (score 0)', () => {
  const m = parseScoreResponse('{"scores":[{"id":"d"}]}');
  assert.equal(m.get('d')?.ai.score, 0);
  assert.equal(m.get('d')?.ai.worthVisit, false);
});

test('parseScoreResponse: scores assente → mappa vuota, niente crash', () => {
  assert.equal(parseScoreResponse('{"altro":1}').size, 0);
});
