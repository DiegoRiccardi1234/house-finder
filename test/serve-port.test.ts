import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FALLBACK_PORTS, rememberPort } from '../scripts/serve.js';

test('porta di riserva: sostituisce PORT esistente, aggiunge se manca, conserva il resto del .env', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hf-port-'));
  try {
    const env = join(dir, '.env');
    writeFileSync(env, 'OPENROUTER_API_KEY=x\nPORT=3000\nSTATE_DIR=state\n');
    rememberPort(env, 3987);
    assert.equal(readFileSync(env, 'utf8'), 'OPENROUTER_API_KEY=x\nPORT=3987\nSTATE_DIR=state\n');

    writeFileSync(env, 'OPENROUTER_API_KEY=x');
    rememberPort(env, 4987);
    const text = readFileSync(env, 'utf8');
    assert.match(text, /^OPENROUTER_API_KEY=x\n# .*\nPORT=4987\n$/);
    assert.equal(text.charCodeAt(0), 'O'.charCodeAt(0), 'niente BOM');

    rmSync(env);
    rememberPort(env, 7987);
    assert.match(readFileSync(env, 'utf8'), /^# .*\nPORT=7987\n$/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.ok(!FALLBACK_PORTS.includes(3000), 'la porta di default non è fra le riserve');
});
