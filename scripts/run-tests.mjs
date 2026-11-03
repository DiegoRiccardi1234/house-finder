import { readdirSync, mkdtempSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const tests = readdirSync(new URL('../test/', import.meta.url))
  .filter((name) => name.endsWith('.test.ts')).sort().map((name) => `test/${name}`);
// A developer's native account/routing must never turn the offline suite into live AI calls.
const temp = mkdtempSync(join(tmpdir(), 'housefinder-offline-suite-'));
const data = join(temp, 'data'); mkdirSync(data);
for (const name of ['criteria.md', 'searches.json', 'facebook.json', 'zones']) cpSync(join(root, 'data', name), join(data, name), { recursive: true });
const env = { ...process.env, DATA_DIR: data, CODEX_HOME: join(temp, 'codex'), CLAUDE_CONFIG_DIR: join(temp, 'claude') };
try {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...process.argv.slice(2), ...tests],
    { cwd: root, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally { rmSync(temp, { recursive: true, force: true, maxRetries: 5 }); }
