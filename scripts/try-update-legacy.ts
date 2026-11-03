/** Real legacy updater matrix. Only copies of installations and synthetic data are used.
 * npx tsx scripts/try-update-legacy.ts --old-install <backup> --old-zip <public-1.7.1.zip>
 * Requires the final new dist/HouseFinder-windows.zip. Never rebuilds or edits an installed app.
 */
import { execFileSync } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

async function main(): Promise<void> {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const value = (flag: string): string | undefined => {
    const index = process.argv.indexOf(flag);
    return index < 0 ? undefined : process.argv[index + 1];
  };
  const install = value('--old-install'); const zip = value('--old-zip');
  if (!install || !zip) throw new Error('Specificare --old-install e --old-zip.');
  await stat(join(root, 'dist', 'HouseFinder-windows.zip'));
  await stat(join(install, 'app', 'scripts', 'updater.js'));
  await stat(zip);
  const script = join(root, 'scripts', 'try-update.ts');
  for (const [label, sourceFlag, source] of [
    ['installed 1.7.0 runtime snapshot', '--from-install', install],
    ['public 1.7.1 ZIP', '--from-zip', zip],
  ]) {
    console.log(`\n=== Legacy upgrade: ${label} ===`);
    execFileSync(process.execPath, ['--import', 'tsx', script, '--reuse', '--keep', '--exact-target', sourceFlag!, source!],
      { cwd: root, env: process.env, stdio: 'inherit', windowsHide: true });
  }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
