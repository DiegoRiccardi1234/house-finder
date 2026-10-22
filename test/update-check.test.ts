import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkForUpdate, isNewer, parseVersion, resetCheckCache } from '../src/update/check.js';
import { APP_VERSION, BUNDLE_ASSET } from '../src/version.js';
import { downloadAsset } from '../src/update/install.js';

/**
 * I test non toccano la rete: `fetch` viene sostituito. Quello che si verifica qui sono le due
 * decisioni che, sbagliate, si vedono solo quando è tardi — il confronto fra versioni e il
 * rifiuto di "aggiornare" all'indietro.
 */

type Fetch = typeof globalThis.fetch;

function withFetch(body: unknown, ok = true): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok,
    status: ok ? 200 : 404,
    json: async () => body,
  })) as unknown as Fetch;
  return () => {
    globalThis.fetch = original;
  };
}

/** Una radice finta che *sembra* un bundle: c'è `node.exe`, quindi `frozen` è vero. */
async function fakeBundle(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hf-bundle-'));
  await writeFile(join(dir, 'node.exe'), 'finto');
  return dir;
}

const release = (tag: string, withAsset = true) => ({
  tag_name: tag,
  html_url: `https://github.com/x/y/releases/tag/${tag}`,
  body: 'note',
  assets: withAsset
    ? [{ name: BUNDLE_ASSET, size: 123, browser_download_url: 'https://example/x.zip' }]
    : [{ name: 'altro.txt', size: 1, browser_download_url: 'https://example/altro.txt' }],
});

test('il confronto fra versioni è numerico, non alfabetico', () => {
  assert.deepEqual(parseVersion('v0.10.2'), [0, 10, 2]);
  assert.deepEqual(parseVersion('1.3.0-rc1'), [1, 3, 0]);
  // Alfabeticamente '0.9' > '0.10': è il modo più silenzioso di non aggiornare mai più dopo la
  // decima patch.
  assert.equal(isNewer('0.10.0', '0.9.0'), true);
  assert.equal(isNewer('0.9.0', '0.10.0'), false);
  assert.equal(isNewer('1.2.0', '1.2.0'), false);
  assert.equal(isNewer('1.2.1', '1.2'), true);
});

test('una release più vecchia non diventa un aggiornamento', async () => {
  const dir = await fakeBundle();
  process.env.INSTALL_ROOT = dir;
  resetCheckCache();
  const restore = withFetch(release('v0.0.1'));
  try {
    const info = await checkForUpdate({ force: true });
    assert.equal(info.checked, true);
    assert.equal(info.latest, 'v0.0.1');
    // `latest !== current` direbbe di sì, e il pulsante "Aggiorna" farebbe un downgrade.
    assert.equal(info.updateAvailable, false);
  } finally {
    restore();
    delete process.env.INSTALL_ROOT;
    await rm(dir, { recursive: true, force: true });
  }
});

test('release nuova senza il bundle allegato: si dice perché, non si finge', async () => {
  const dir = await fakeBundle();
  process.env.INSTALL_ROOT = dir;
  resetCheckCache();
  const restore = withFetch(release('v99.0.0', false));
  try {
    const info = await checkForUpdate({ force: true });
    assert.equal(info.updateAvailable, false);
    assert.match(info.detail ?? '', new RegExp(BUNDLE_ASSET));
  } finally {
    restore();
    delete process.env.INSTALL_ROOT;
    await rm(dir, { recursive: true, force: true });
  }
});

test('dai sorgenti non si aggiorna col bottone: si dice di fare git pull', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hf-src-'));
  process.env.INSTALL_ROOT = dir; // niente node.exe → frozen false
  resetCheckCache();
  const restore = withFetch(release('v99.0.0'));
  try {
    const info = await checkForUpdate({ force: true });
    assert.equal(info.frozen, false);
    assert.equal(info.updateAvailable, false);
    assert.match(info.detail ?? '', /git pull/);
  } finally {
    restore();
    delete process.env.INSTALL_ROOT;
    await rm(dir, { recursive: true, force: true });
  }
});

test('GitHub muto non rompe niente: checked=false e la versione locale resta', async () => {
  resetCheckCache();
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('rete assente');
  }) as unknown as Fetch;
  try {
    const info = await checkForUpdate({ force: true });
    assert.equal(info.checked, false);
    assert.equal(info.updateAvailable, false);
    assert.equal(info.current, APP_VERSION);
  } finally {
    globalThis.fetch = original;
    resetCheckCache();
  }
});

test('download fermo viene abortito e il file parziale eliminato', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'hf-download-stalled-'));
  const path = join(dir, 'partial.zip');
  const original = globalThis.fetch;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let progressed!: () => void;
  const firstProgress = new Promise<void>((resolve) => { progressed = resolve; });
  globalThis.fetch = (async (_url, init) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason), { once: true });
      },
    });
    return new Response(stream, { headers: { 'content-length': '100' } });
  }) as Fetch;
  try {
    const check = assert.rejects(downloadAsset({ name: 'x.zip', size: 100, url: 'https://example.invalid/x.zip', digest: null }, path,
      () => progressed()), /nessun avanzamento/);
    await firstProgress;
    t.mock.timers.tick(60_000);
    await check;
    await assert.rejects(access(path));
  } finally {
    globalThis.fetch = original;
    t.mock.timers.reset();
    await rm(dir, { recursive: true, force: true });
  }
});

test('download senza risposta rispetta anche il limite complessivo', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'hf-download-deadline-'));
  const original = globalThis.fetch;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let requested!: () => void;
  const started = new Promise<void>((resolve) => { requested = resolve; });
  globalThis.fetch = ((_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    requested();
  })) as Fetch;
  try {
    const check = assert.rejects(downloadAsset({ name: 'x.zip', size: 100, url: 'https://example.invalid/x.zip', digest: null }, join(dir, 'x.zip'),
      () => {}, { timeoutMs: 1000 }), /troppo lungo/);
    await started;
    t.mock.timers.tick(1000);
    await check;
  } finally {
    globalThis.fetch = original;
    t.mock.timers.reset();
    await rm(dir, { recursive: true, force: true });
  }
});

test('download con avanzamento rinnova il limite di inattività', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'hf-download-progress-'));
  const path = join(dir, 'complete.zip');
  const original = globalThis.fetch;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let source!: ReadableStreamDefaultController<Uint8Array>;
  let signal!: AbortSignal;
  let notify!: () => void;
  let progress = new Promise<void>((resolve) => { notify = resolve; });
  globalThis.fetch = (async (_url, init) => {
    signal = init!.signal!;
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      source = controller;
      controller.enqueue(new Uint8Array([1]));
    } }));
  }) as Fetch;
  try {
    const download = downloadAsset({ name: 'x.zip', size: 3, url: 'https://example.invalid/x.zip', digest: null }, path, () => notify());
    await progress;
    for (const byte of [2, 3]) {
      t.mock.timers.tick(45_000);
      assert.equal(signal.aborted, false);
      progress = new Promise<void>((resolve) => { notify = resolve; });
      source.enqueue(new Uint8Array([byte]));
      await progress;
    }
    source.close();
    await download;
    assert.deepEqual([...await readFile(path)], [1, 2, 3]);
  } finally {
    globalThis.fetch = original;
    t.mock.timers.reset();
    await rm(dir, { recursive: true, force: true });
  }
});
