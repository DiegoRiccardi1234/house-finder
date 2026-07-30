import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CATALOG, specOf, isProviderId } from '../src/ai/providers/catalog.js';
import {
  configuredProviders,
  endpointFor,
  invalidateCreds,
  isConfigured,
  keyFor,
  keyStateOf,
  markKeyInvalid,
  primaryProvider,
  providerOrder,
  saveKey,
  setPrimary,
} from '../src/ai/credentials.js';

async function withDataDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'hf-prov-'));
  await mkdir(join(dir, 'local'), { recursive: true });
  const prevDir = process.env.DATA_DIR;
  const prevEnv = { ...process.env };
  process.env.DATA_DIR = dir;
  invalidateCreds();
  try {
    await fn(dir);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in prevEnv)) delete process.env[k];
    Object.assign(process.env, prevEnv);
    if (prevDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prevDir;
    invalidateCreds();
    await rm(dir, { recursive: true, force: true });
  }
}

test('catalogo: 11 provider, id validi, baseURL presente tranne openai/custom', () => {
  assert.equal(CATALOG.length, 11);
  for (const s of CATALOG) {
    assert.ok(isProviderId(s.id), `${s.id} non riconosciuto`);
    assert.ok(s.label.length > 0);
    assert.ok(s.signup.startsWith('https://'), `${s.id}: signup non https`);
    // openai usa il default dell'SDK, custom lo chiede all'utente.
    if (s.id !== 'openai' && s.id !== 'custom') {
      assert.ok(s.baseURL.startsWith('https://'), `${s.id}: baseURL mancante`);
    }
  }
});

test('catalogo: anthropic non ha json nativo, custom ha timeout lungo e key opzionale', () => {
  assert.equal(specOf('anthropic').caps.json, 'prefill');
  assert.equal(specOf('custom').keyOptional, true);
  assert.ok(specOf('custom').caps.timeoutMs >= 120_000, 'un modello locale impiega minuti');
  assert.equal(specOf('openrouter').caps.health, 'openrouter');
  assert.equal(specOf('groq').caps.health, 'none');
});

test('keyFor: il file vince sulla env', async () => {
  await withDataDir(async () => {
    process.env.GROQ_API_KEY = 'da-env';
    assert.equal(keyFor('groq'), 'da-env');
    await saveKey('groq', 'da-file');
    assert.equal(keyFor('groq'), 'da-file');
  });
});

test('saveKey: stringa vuota cancella, undefined non tocca', async () => {
  await withDataDir(async (dir) => {
    await saveKey('groq', 'abc');
    assert.equal(isConfigured('groq'), true);

    await saveKey('groq', undefined, undefined); // no-op
    assert.equal(keyFor('groq'), 'abc');

    await saveKey('groq', '');
    delete process.env.GROQ_API_KEY;
    assert.equal(isConfigured('groq'), false);

    const raw = JSON.parse(await readFile(join(dir, 'local', 'providers.json'), 'utf8'));
    assert.equal(raw.keys.groq, undefined);
  });
});

test('custom: configurato dall’endpoint, non dalla key', async () => {
  await withDataDir(async () => {
    assert.equal(isConfigured('custom'), false);
    await saveKey('custom', undefined, 'http://localhost:11434/v1');
    assert.equal(isConfigured('custom'), true);
    assert.equal(endpointFor('custom'), 'http://localhost:11434/v1');
  });
});

test('keyState: invalid ha un cooldown, non è definitivo', async () => {
  await withDataDir(async () => {
    await saveKey('groq', 'abc');
    assert.equal(keyStateOf('groq'), 'ok');
    markKeyInvalid('groq');
    assert.equal(keyStateOf('groq'), 'invalid');
    // Salvare di nuovo azzera lo stato: l'utente ha corretto la key.
    await saveKey('groq', 'def');
    assert.equal(keyStateOf('groq'), 'ok');
  });
});

test('primario e ordine di failover: il primario apre la lista', async () => {
  await withDataDir(async () => {
    for (const k of CATALOG) delete process.env[k.envVar];
    await saveKey('groq', 'a');
    await saveKey('openrouter', 'b');
    assert.deepEqual(configuredProviders().sort(), ['groq', 'openrouter']);

    await setPrimary('openrouter');
    assert.equal(primaryProvider(), 'openrouter');
    assert.deepEqual(providerOrder(), ['openrouter', 'groq']);
  });
});

test('primario non configurato: si ripiega sul primo disponibile', async () => {
  await withDataDir(async () => {
    for (const k of CATALOG) delete process.env[k.envVar];
    await setPrimary('groq'); // salvato ma senza key
    await saveKey('cerebras', 'x');
    assert.equal(primaryProvider(), 'cerebras');
  });
});
