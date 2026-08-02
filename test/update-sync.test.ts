import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COPY_RETRY_DELAYS_MS, syncInstallDir } from '../src/update/sync.js';
import { isPreserved, PRESERVE } from '../src/config/install.js';

/**
 * Ogni test qui è la cicatrice di un guasto vero su Job/Trip Finder. La copia dei file è la
 * parte che, quando sbaglia, lascia un'installazione a metà — cioè peggio di un aggiornamento
 * che non parte.
 */

async function scenario(): Promise<{ src: string; dest: string; clean: () => Promise<void> }> {
  const base = await mkdtemp(join(tmpdir(), 'hf-sync-'));
  const src = join(base, 'nuovo');
  const dest = join(base, 'installato');
  await mkdir(join(src, 'app', 'scripts'), { recursive: true });
  await mkdir(join(src, 'app', 'data', 'local'), { recursive: true });
  await mkdir(join(src, 'state'), { recursive: true });
  await mkdir(join(dest, 'app', 'data', 'local'), { recursive: true });
  await mkdir(join(dest, 'state'), { recursive: true });

  await writeFile(join(src, 'node.exe'), 'nuovo-node');
  await writeFile(join(src, 'app', 'scripts', 'serve.js'), 'nuovo-serve');
  await writeFile(join(src, 'app', 'data', 'local', 'criteria.md'), 'ESEMPIO');
  await writeFile(join(src, 'state', 'listings.json'), '[]');

  await writeFile(join(dest, 'node.exe'), 'vecchio-node');
  await writeFile(join(dest, 'app', 'data', 'local', 'criteria.md'), 'I MIEI CRITERI');
  await writeFile(join(dest, 'state', 'listings.json'), '[{"mio":true}]');
  await writeFile(join(dest, '.env'), 'IMAP_PASS=segreto');
  await writeFile(join(dest, 'file-di-una-vecchia-versione.js'), 'ciao');

  return { src, dest, clean: () => rm(base, { recursive: true, force: true }) };
}

test('archivio, segreti e config personale sopravvivono', async () => {
  const { src, dest, clean } = await scenario();
  try {
    await syncInstallDir(src, dest);
    assert.equal(await readFile(join(dest, 'state', 'listings.json'), 'utf8'), '[{"mio":true}]');
    assert.equal(await readFile(join(dest, '.env'), 'utf8'), 'IMAP_PASS=segreto');
    // La trappola di House Finder: `paths.ts` risolve la cartella dati come `../../data/`, quindi
    // nel bundle la config personale sta DENTRO `app/`, cioè dentro ciò che si riscrive.
    assert.equal(
      await readFile(join(dest, 'app', 'data', 'local', 'criteria.md'), 'utf8'),
      'I MIEI CRITERI',
    );
    // E il resto invece si aggiorna davvero.
    assert.equal(await readFile(join(dest, 'app', 'scripts', 'serve.js'), 'utf8'), 'nuovo-serve');
    assert.equal(await readFile(join(dest, 'node.exe'), 'utf8'), 'nuovo-node');
  } finally {
    await clean();
  }
});

test('non cancella niente: un file di troppo non ha mai rotto niente, uno mancante sì', async () => {
  const { src, dest, clean } = await scenario();
  try {
    await syncInstallDir(src, dest);
    assert.equal(await readFile(join(dest, 'file-di-una-vecchia-versione.js'), 'utf8'), 'ciao');
  } finally {
    await clean();
  }
});

test('non si riscrive addosso all\'eseguibile in uso', async () => {
  const { src, dest, clean } = await scenario();
  try {
    const esito = await syncInstallDir(src, dest, { currentExe: join(dest, 'node.exe') });
    assert.equal(await readFile(join(dest, 'node.exe'), 'utf8'), 'vecchio-node');
    assert.ok(esito.skipped.includes('node.exe'));
  } finally {
    await clean();
  }
});

/** Un `copyFile` che finge un file tenuto aperto, come fa Defender sull'archivio appena estratto. */
function bloccaPer(volte: number, quale: string, vero: typeof copyFile) {
  let falliti = 0;
  const impl = async (from: string, to: string): Promise<void> => {
    if (to.endsWith(quale) && falliti < volte) {
      falliti++;
      const e = new Error('busy') as NodeJS.ErrnoException;
      e.code = 'EBUSY';
      throw e;
    }
    await vero(from, to);
  };
  return { impl, falliti: () => falliti };
}

test('un file bloccato si riprova prima di arrendersi', async () => {
  const { src, dest, clean } = await scenario();
  try {
    const attese: number[] = [];
    const finto = bloccaPer(2, 'node.exe', copyFile);
    await syncInstallDir(src, dest, {
      retryDelaysMs: [1, 2, 4],
      copyFileImpl: finto.impl,
      sleep: async (ms) => {
        attese.push(ms);
      },
    });
    assert.equal(finto.falliti(), 2);
    assert.deepEqual(attese, [1, 2]);
    assert.equal(await readFile(join(dest, 'node.exe'), 'utf8'), 'nuovo-node');
  } finally {
    await clean();
  }
});

test('se resta bloccato, l\'errore dice QUALE file', async () => {
  const { src, dest, clean } = await scenario();
  try {
    const finto = bloccaPer(Number.MAX_SAFE_INTEGER, 'node.exe', copyFile);
    await assert.rejects(
      syncInstallDir(src, dest, {
        retryDelaysMs: [1],
        copyFileImpl: finto.impl,
        sleep: async () => {},
      }),
      // È l'unica informazione che distingue "antivirus" da "bug".
      /node\.exe/,
    );
  } finally {
    await clean();
  }
});

test('la scala di attese arriva a ~31 s: con 1,2,4 falliva sempre 7 s dopo', () => {
  const totale = COPY_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
  assert.ok(totale >= 30_000, `attese totali ${totale} ms: Defender tiene gli handle 10-20 s`);
});

test('la lista dei protetti riconosce i percorsi annidati', () => {
  assert.ok(PRESERVE.includes('app/data/local'));
  assert.equal(isPreserved('app/data/local/criteria.md'), true);
  assert.equal(isPreserved('app\\data\\local\\criteria.md'), true);
  assert.equal(isPreserved('app/data/criteria.md'), false);
  assert.equal(isPreserved('state/listings.json'), true);
  assert.equal(isPreserved('stateful.js'), false);
});
