import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { normalizeImageUrl, isAllowedImageHost } from '../src/core/img-fetch.js';

// THUMBS_DIR viene letto all'import del modulo: va impostato PRIMA di caricarlo.
const DIR = mkdtempSync(join(tmpdir(), 'hf-thumbs-'));
process.env.THUMBS_DIR = DIR;
const {
  cacheKey,
  cacheThumb,
  cacheThumbs,
  isCachedThumb,
  thumbFilePath,
  thumbContentType,
  readThumbDataUri,
  pruneThumbs,
  THUMB_URL_PREFIX,
} = await import('../src/core/thumbs.js');

const FB_A =
  'https://scontent.fmxp5-1.fna.fbcdn.net/v/t39.84726-6/740521587_225_n.jpg?stp=c0.43&_nc_gid=AAA&oh=00_AQD1&oe=6A5B1E38';
const FB_B =
  'https://scontent.fmxp5-1.fna.fbcdn.net/v/t39.84726-6/740521587_225_n.jpg?stp=c0.43&_nc_gid=ZZZ&oh=00_AQD9&oe=6B000000';
const SUBITO = 'https://images.sbito.it/api/v1/sbt-ads-images-pro/images/7b/7bd3f8ed';

/** Sostituisce `fetch` con una risposta immagine finta. */
function stubImageFetch(opts: { status?: number; type?: string; bytes?: Buffer } = {}) {
  const { status = 200, type = 'image/jpeg', bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]) } = opts;
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? type : null) },
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    } as unknown as Response;
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test('cacheKey: la firma volatile di Facebook non conta, il path sì', () => {
  // Stessa foto, due scrape diversi: `oh`/`oe`/`_nc_gid` cambiano ma il file è quello.
  assert.equal(cacheKey(FB_A), cacheKey(FB_B));
  assert.notEqual(cacheKey(FB_A), cacheKey(FB_A.replace('740521587', '999999999')));
  // Altrove la query È l'immagine: su Subito `?rule=` decide la dimensione servita.
  assert.notEqual(cacheKey(SUBITO), cacheKey(`${SUBITO}?rule=large-fixed-card-1x-auto`));
});

test('normalizeImageUrl: il `?rule=` di Subito è obbligatorio, altrove non si tocca niente', () => {
  assert.match(normalizeImageUrl(SUBITO), /\?rule=large-fixed-card-1x-auto$/);
  assert.equal(normalizeImageUrl(`${SUBITO}?rule=custom`), `${SUBITO}?rule=custom`);
  assert.equal(normalizeImageUrl(FB_A), FB_A);
  assert.equal(normalizeImageUrl('non-un-url'), 'non-un-url');
});

test('isAllowedImageHost: solo le CDN dei portali', () => {
  assert.ok(isAllowedImageHost('images.sbito.it'));
  assert.ok(isAllowedImageHost('scontent.fmxp5-1.fna.fbcdn.net'));
  assert.ok(isAllowedImageHost('pwm.im-cdn.it'));
  assert.ok(!isAllowedImageHost('127.0.0.1'));
  assert.ok(!isAllowedImageHost('evil.example.com'));
});

test('cacheThumb: scarica una volta sola e ritorna il percorso pubblico', async () => {
  const stub = stubImageFetch();
  try {
    const p = await cacheThumb(SUBITO);
    assert.ok(p?.startsWith(THUMB_URL_PREFIX));
    assert.ok(isCachedThumb(p));
    assert.equal(stub.calls.length, 1);
    // L'URL parte senza `?rule=`: viene normalizzato prima del download.
    assert.match(stub.calls[0], /rule=large-fixed-card-1x-auto/);

    // Seconda chiamata: hit di cache, nessuna richiesta in più.
    const again = await cacheThumb(SUBITO);
    assert.equal(again, p);
    assert.equal(stub.calls.length, 1);

    const dataUri = await readThumbDataUri(p as string);
    assert.match(dataUri as string, /^data:image\/jpeg;base64,/);
  } finally {
    stub.restore();
  }
});

test('cacheThumb: fallimenti ritornano null senza sollevare', async () => {
  const dead = stubImageFetch({ status: 403 });
  try {
    assert.equal(await cacheThumb(FB_A), null); // URL firmato scaduto
  } finally {
    dead.restore();
  }

  const html = stubImageFetch({ type: 'text/html' });
  try {
    assert.equal(await cacheThumb(`${SUBITO}-html`), null); // pagina di errore travestita da immagine
  } finally {
    html.restore();
  }

  const never = stubImageFetch();
  try {
    assert.equal(await cacheThumb('https://127.0.0.1/interno.jpg'), null); // host non ammesso
    assert.equal(await cacheThumb('http://images.sbito.it/x.jpg'), null); // solo https
    assert.equal(await cacheThumb(''), null);
    assert.equal(never.calls.length, 0, 'host non ammesso = nessuna richiesta di rete');
  } finally {
    never.restore();
  }
});

test('cacheThumbs: mappa urlOriginale → percorso, senza duplicati', async () => {
  const stub = stubImageFetch();
  try {
    const url = `${SUBITO}-batch`;
    const map = await cacheThumbs([url, url, '']);
    assert.equal(map.size, 1);
    assert.ok(map.get(url)?.startsWith(THUMB_URL_PREFIX));
    assert.equal(stub.calls.length, 1, 'gli URL ripetuti si scaricano una volta sola');
  } finally {
    stub.restore();
  }
});

test('thumbFilePath: niente traversal fuori dalla cartella', () => {
  assert.equal(thumbFilePath('/thumbs/../../etc/passwd'), null);
  assert.equal(thumbFilePath('/thumbs/abc.exe'), null);
  assert.equal(thumbFilePath('https://esterno/x.jpg'), null);
  assert.equal(thumbFilePath('/thumbs/abc.jpg'), join(DIR, 'abc.jpg'));
});

test('thumbContentType: avif incluso (Express 4 non lo conosce)', () => {
  assert.equal(thumbContentType('/x/abc.avif'), 'image/avif');
  assert.equal(thumbContentType('/x/abc.jpg'), 'image/jpeg');
  assert.equal(thumbContentType('/x/abc.txt'), null);
});

test('pruneThumbs: toglie i file orfani ma non svuota su archivio senza riferimenti', async () => {
  writeFileSync(join(DIR, 'orfano.jpg'), 'x');
  writeFileSync(join(DIR, 'tenuto.jpg'), 'x');

  assert.equal(await pruneThumbs([]), 0, 'nessun riferimento: non è l’archivio vero, non si tocca niente');
  assert.ok(readdirSync(DIR).includes('orfano.jpg'));

  const removed = await pruneThumbs(['/thumbs/tenuto.jpg']);
  assert.ok(removed >= 1);
  const left = readdirSync(DIR);
  assert.ok(left.includes('tenuto.jpg'));
  assert.ok(!left.includes('orfano.jpg'));
});

test('pipeline: foto in cache sui nuovi, self-heal degli URL remoti sui già-visti', async () => {
  const stub = stubImageFetch();
  try {
    const { ListingStore } = await import('../src/core/store.js');
    const { ingest } = await import('../src/core/pipeline.js');
    const store = await ListingStore.load(join(DIR, 'listings-pipeline.json'));
    const listing = { source: 'subito', id: 'p1', url: 'https://x/p1', title: 't', price: 500, thumb: SUBITO };
    const opts = { store, score: false, vision: false, log: () => {} };

    await ingest([listing], 'subito', opts);
    assert.ok(isCachedThumb(store.get('subito:p1')?.photos[0]), 'il nuovo salva la copia locale');

    const downloads = stub.calls.length;
    await ingest([listing], 'subito', opts);
    assert.equal(stub.calls.length, downloads, 'già in cache: nessun download in più');

    // Record vecchio: in archivio c'è ancora l'URL remoto (è il caso degli annunci pre-cache).
    store.get('subito:p1')!.photos = [FB_A];
    await ingest([{ ...listing, thumb: FB_A }], 'subito', opts);
    assert.ok(isCachedThumb(store.get('subito:p1')?.photos[0]), 'il già-visto si ripara da solo');
  } finally {
    stub.restore();
  }
});

test('server: /thumbs serve i file con il Content-Type giusto', async () => {
  writeFileSync(join(DIR, 'servito.avif'), 'finta-immagine');
  const { ListingStore } = await import('../src/core/store.js');
  const { createApp } = await import('../src/server/app.js');
  const store = await ListingStore.load(join(DIR, 'listings-test.json'));
  const app = createApp({ store });

  const res = await request(app).get('/thumbs/servito.avif');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /image\/avif/);

  assert.equal((await request(app).get('/thumbs/manca.jpg')).status, 404);
});
