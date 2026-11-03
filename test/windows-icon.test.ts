import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('Windows ICO contains seven deterministic DIB sizes and shared house pixels', { skip: process.platform !== 'win32' }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'hf-icon space-'));
  try {
    const script = fileURLToPath(new URL('../scripts/build-windows-icon.ps1', import.meta.url));
    for (const name of ['first.ico', 'second.ico']) execFileSync('powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Out', join(temp, name)],
      { windowsHide: true, stdio: 'pipe' });
    const first = await readFile(join(temp, 'first.ico'));
    assert.deepEqual(first, await readFile(join(temp, 'second.ico')));
    assert.equal(first.readUInt16LE(0), 0);
    assert.equal(first.readUInt16LE(2), 1);
    assert.equal(first.readUInt16LE(4), 7);
    const sizes = [16, 24, 32, 48, 64, 128, 256];
    for (const [index, size] of sizes.entries()) {
      const offset = 6 + index * 16;
      assert.equal(first[offset] || 256, size);
      assert.equal(first[offset + 1] || 256, size);
      assert.equal(first.readUInt16LE(offset + 6), 32);
      const imageOffset = first.readUInt32LE(offset + 12);
      const imageLength = first.readUInt32LE(offset + 8);
      const dib = first.subarray(imageOffset, imageOffset + imageLength);
      assert.equal(dib.readUInt32LE(0), 40);
      assert.equal(dib.readUInt32LE(4), size);
      assert.equal(dib.readUInt32LE(8), size * 2);
      assert.equal(dib.readUInt16LE(14), 32);
      assert.ok(imageLength > size * size * 4);
    }
    // Decode via Windows, checking design pixels independently of PNG compression bytes.
    const icon = join(temp, 'first.ico').replace(/'/g, "''");
    const pixels = execFileSync('powershell', ['-NoProfile', '-Command',
      `Add-Type -AssemblyName System.Drawing; $i=New-Object Drawing.Icon '${icon}',64,64; $b=$i.ToBitmap(); ` +
      `try { '{0},{1},{2}' -f $b.GetPixel(32,5).ToArgb(),$b.GetPixel(32,25).ToArgb(),$b.GetPixel(32,44).ToArgb() } finally {$b.Dispose();$i.Dispose()}`],
    { encoding: 'utf8', windowsHide: true }).trim();
    const green = (0xff4a6b52 | 0).toString(); const white = (0xffffffff | 0).toString();
    assert.equal(pixels, `${green},${white},${green}`);
    const code = join(temp, 'IconProbe.cs'); const exe = join(temp, 'IconProbe.exe');
    await writeFile(code, 'static class IconProbe { static void Main() {} }');
    const csc = join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
    execFileSync(csc, ['/nologo', '/target:winexe', `/win32icon:${join(temp, 'first.ico')}`, `/out:${exe}`, code],
      { windowsHide: true, stdio: 'pipe' });
    const shellPixels = execFileSync('powershell', ['-NoProfile', '-Command',
      `Add-Type -AssemblyName System.Drawing; $i=[Drawing.Icon]::ExtractAssociatedIcon('${exe.replace(/'/g, "''")}'); $b=$i.ToBitmap(); ` +
      `try { '{0},{1}' -f $b.GetPixel([int]($b.Width/2),[int]($b.Height*0.08)).ToArgb(),$b.GetPixel([int]($b.Width/2),[int]($b.Height*0.4)).ToArgb() } finally {$b.Dispose();$i.Dispose()}`],
    { encoding: 'utf8', windowsHide: true }).trim();
    assert.equal(shellPixels, `${green},${white}`);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('bundle fails on launcher errors and distributes the shared tray icon', async () => {
  const builder = await readFile(new URL('../scripts/build-bundle.mjs', import.meta.url), 'utf8');
  const tray = await readFile(new URL('../scripts/tray.ps1', import.meta.url), 'utf8');
  assert.match(builder, /build-windows-icon\.ps1/);
  assert.match(builder, /\['app', 'scripts', 'house\.ico'\]/);
  assert.match(builder, /Impossibile costruire HouseFinder\.exe/);
  assert.doesNotMatch(builder, /ripiego sul \.vbs/);
  assert.match(tray, /Join-Path \$PSScriptRoot 'house\.ico'/);
});
