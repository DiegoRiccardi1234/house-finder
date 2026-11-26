import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Nessun byte di controllo nei sorgenti. È successo due volte: un NUL al posto di uno spazio in
 * `profile.ts`, poi un backspace (0x08) al posto di `\b` in una regex di `score.ts` — invisibile
 * a occhio e nel diff, e la regex non riconosceva più "si". Ammessi solo tab, a capo e ritorno.
 */
const ROOTS = ['src', 'ui/src', 'scripts', 'test'];
const EXT = /\.(ts|tsx|mts|mjs|js|css)$/;

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (EXT.test(name)) yield p;
  }
}

test('sorgenti senza byte di controllo invisibili', () => {
  const bad: string[] = [];
  for (const root of ROOTS) {
    for (const f of files(root)) {
      const buf = readFileSync(f);
      for (let i = 0; i < buf.length; i++) {
        const b = buf[i]!;
        if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) {
          const line = buf.subarray(0, i).toString('utf8').split('\n').length;
          bad.push(`${f}:${line} (0x${b.toString(16).padStart(2, '0')})`);
          break;
        }
      }
    }
  }
  assert.deepEqual(bad, []);
});
