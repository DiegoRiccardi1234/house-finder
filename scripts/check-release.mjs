import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');
const version = read('src/version.ts').match(/APP_VERSION\s*=\s*'([^']+)'/)?.[1];
if (!version) throw new Error('APP_VERSION assente');
for (const path of ['package.json', 'ui/package.json', 'package-lock.json', 'ui/package-lock.json']) {
  const pkg = JSON.parse(read(path));
  if (pkg.version !== version || (pkg.packages && pkg.packages[''].version !== version)) {
    throw new Error(`Versione incoerente in ${path}`);
  }
}
const tag = process.argv[2];
if (tag && tag !== `v${version}`) throw new Error(`Tag ${tag} diverso da v${version}`);
if (!read('CHANGELOG.md').includes(`## [${version}]`)) throw new Error('Sezione changelog assente');
console.log(`Release v${version}: versioni e changelog coerenti.`);
