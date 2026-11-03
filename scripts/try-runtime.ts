/** Explicit live subscription smoke. Only synthetic inputs; no real archive/profile or API fallback. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { z } from 'zod';
import { saveConnectionConfig, AI_TASKS, type AiConnection } from '../src/ai/connections.js';
import { connectionDiagnostics, taskChat } from '../src/ai/task-routing.js';
import { closeRuntimes } from '../src/ai/runtime.js';

function redPng(): string {
  function crc(bytes: Buffer): number {
    let value = 0xffffffff;
    for (const byte of bytes) { value ^= byte; for (let n = 0; n < 8; n++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0); }
    return (value ^ 0xffffffff) >>> 0;
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]), size = Buffer.alloc(4), checksum = Buffer.alloc(4);
    size.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(body)); return Buffer.concat([size, body, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(32, 0); header.writeUInt32BE(32, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(32 * (1 + 32 * 3));
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) pixels[y * 97 + 1 + x * 3] = 255;
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
async function main() {
  const temp = await mkdtemp(join(tmpdir(), 'hf-runtime-live-'));
  const reportDir = resolve('.house-finder-private', `runtime-smoke-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(reportDir, { recursive: true });
  const original = { DATA_DIR: process.env.DATA_DIR, STATE_DIR: process.env.STATE_DIR, LISTINGS_PATH: process.env.LISTINGS_PATH };
  Object.assign(process.env, { DATA_DIR: join(temp, 'data'), STATE_DIR: join(temp, 'state'), LISTINGS_PATH: join(temp, 'state', 'listings.json') });
  const checks: { task: string; ok: boolean; elapsedMs: number; result?: unknown; code?: string; detail?: string }[] = [];
  const connection: AiConnection = { id: 'synthetic-codex', label: 'Codex synthetic smoke', kind: 'codex', model: 'gpt-6.1-sol', reasoning: 'high', enabled: true, vision: true };
  let diagnostic: unknown;
  try {
    await saveConnectionConfig({ version: 1, connections: [connection], tasks: Object.fromEntries(AI_TASKS.map((task) => [task, { connectionId: connection.id, fallbackIds: [] }])) });
    diagnostic = await connectionDiagnostics(connection.id);
    const ready = diagnostic as { ready: boolean; models: { id: string }[]; code?: string; detail?: string };
    if (!ready.ready) throw Object.assign(new Error(ready.detail ?? 'Runtime non disponibile'), { code: ready.code });
    if (!ready.models.some((model) => model.id === connection.model)) throw Object.assign(new Error('Il modello scelto non è disponibile nell’account; nessun altro modello selezionato.'), { code: 'model_unavailable' });
    const run = async (task: typeof AI_TASKS[number], body: Parameters<typeof taskChat>[1], verify: (text: string) => unknown) => {
      const started = Date.now();
      try {
        const reply = await taskChat(task, body);
        const result = verify(reply.text);
        checks.push({ task, ok: true, elapsedMs: Date.now() - started, result });
        console.log(`${task}: OK (${Date.now() - started}ms)`);
      } catch (error) {
        const err = error as Error & { code?: string };
        checks.push({ task, ok: false, elapsedMs: Date.now() - started, code: err.code ?? 'acceptance_failed', detail: err.message });
        console.log(`${task}: FAILED (${err.code ?? 'acceptance_failed'})`);
      }
      await writeFile(join(reportDir, 'report.json'), JSON.stringify({ synthetic: true, model: connection.model, diagnostic, checks }, null, 2));
    };
    await run('scoring', { json: true, schema: z.object({ scores: z.array(z.object({ id: z.string(), score: z.number().min(0).max(100) })).length(2) }),
      messages: [{ role: 'user', content: 'Fixture sintetiche. Criterio: bilocale arredato a Firenze, massimo 800 euro/mese. Annuncio test:good: bilocale arredato Firenze 650 euro. Annuncio test:bad: garage Torino 1500 euro. Rispondi {"scores":[{"id":"test:good","score":numero},{"id":"test:bad","score":numero}]}. Usa solo questi due ID e valuta la corrispondenza 0-100.' }] },
    (text) => { const value = JSON.parse(text); assert.deepEqual(value.scores.map((row: {id: string}) => row.id).sort(), ['test:bad', 'test:good']); assert.ok(value.scores.find((x: {id: string}) => x.id === 'test:good').score > value.scores.find((x: {id: string}) => x.id === 'test:bad').score); return value; });
    await run('vision', { messages: [{ role: 'user', content: [{ type: 'text', text: 'Descrivi in italiano il colore principale di questa immagine sintetica, in una frase.' }, { type: 'image', url: redPng() }] }] },
      (text) => { assert.match(text.toLowerCase(), /ross[oaioe]/); return text; });
    await run('search', { json: true, schema: z.object({ city: z.literal('firenze'), maxPrice: z.literal(800), minRooms: z.literal(2) }),
      messages: [{ role: 'user', content: 'Dati sintetici: cerco un bilocale a Firenze sotto 800 euro. Rispondi JSON con city (slug minuscolo), maxPrice e minRooms.' }] }, (text) => JSON.parse(text));
    await run('zones', { json: true, schema: z.object({ zones: z.array(z.string()).min(3) }),
      messages: [{ role: 'user', content: 'Test sintetico: elenca tre nomi di quartieri di Firenze. Rispondi solo {"zones":["...","...","..."]}.' }] }, (text) => JSON.parse(text));
    await run('chat', { messages: [{ role: 'user', content: 'Test sintetico chat. Quanto fa 2+3? Rispondi con il solo numero.' }] }, (text) => { assert.equal(text.trim(), '5'); return text; });
    if (checks.length !== 5 || checks.some((check) => !check.ok)) process.exitCode = 1;
  } catch (error) {
    const err = error as Error & { code?: string };
    await writeFile(join(reportDir, 'report.json'), JSON.stringify({ synthetic: true, model: connection.model, diagnostic, checks, failure: { code: err.code ?? 'runtime_unavailable', detail: err.message } }, null, 2));
    console.error(`Runtime smoke failed: ${err.code ?? 'runtime_unavailable'}`); process.exitCode = 1;
  } finally {
    closeRuntimes();
    for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(temp, { recursive: true, force: true, maxRetries: 5 });
    console.log(`Report: ${reportDir}`);
  }
}
main().catch(() => { console.error('Errore nel collaudo runtime sintetico.'); process.exitCode = 1; });
