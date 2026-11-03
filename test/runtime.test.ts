import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runtimeChat, runtimeStatus, runtimeEnvironment, codexOverrides, closeRuntimes, RuntimeError } from '../src/ai/runtime.js';
import type { AiConnection } from '../src/ai/connections.js';
const fake = fileURLToPath(new URL('./fixtures/fake-agent-runtime.mjs', import.meta.url));
const connection: AiConnection = { id: 'test-runtime', label: 'Test', kind: 'codex', model: 'test-model', reasoning: 'high', vision: true, enabled: true };
const request = { model: '', messages: [{ role: 'user' as const, content: 'Dati sintetici' }] };
const options = (scenario = 'success') => ({ command: { file: process.execPath, args: [fake, scenario] }, configText: '', timeoutMs: 5000 });

test('runtime: JSONL frammentato, risposta finale e immagini senza tool né credenziali ereditate', async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'fake-api-secret';
  try {
    const result = await runtimeChat(connection, { ...request, json: true, messages: [{ role: 'user', content: [
      { type: 'text', text: 'fixture' }, { type: 'image', url: 'data:image/png;base64,aGVsbG8=' },
    ] }] }, options());
    const report = JSON.parse(result.text);
    assert.equal(report.ok, true); assert.equal(report.images, 1); assert.equal(report.envClean, true);
    assert.equal(report.effort, 'high'); assert.match(report.cwd, /house-finder-runtime-/);
    assert.ok(report.overrides.includes('features.plugins=false'));
    assert.ok(report.overrides.includes('forced_login_method="chatgpt"'));
  } finally { if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey; }
});
test('runtime: diagnostica non esegue inferenze e verifica auth account e modelli', async () => {
  const status = await runtimeStatus(connection, options());
  assert.equal(status.authenticated, true); assert.equal(status.models[0].vision, true);
  const absent = await runtimeStatus(connection, options('unauthenticated'));
  assert.equal(absent.ready, false); assert.equal(absent.code, 'not_authenticated');
});
test('runtime: account API, tool richiesti, quota, troncamento e JSON rotto danno errori controllati', async () => {
  for (const [scenario, code] of [['api-account', 'subscription_required'], ['tool', 'tools_disabled'], ['tool-start', 'tools_disabled'], ['quota', 'quota_exhausted'], ['length', 'truncated'], ['malformed', 'protocol_error']]) {
    await assert.rejects(runtimeChat(connection, { ...request, json: true }, options(scenario)), (e: unknown) => {
      assert.ok(e instanceof RuntimeError); assert.equal(e.code, code); assert.doesNotMatch(e.message, /PRIVATE_SECRET/); return true;
    });
  }
});
test('runtime: annullamento in coda non avvia seconda richiesta; timeout e shutdown liberano la coda', async () => {
  const controller = new AbortController();
  const first = runtimeChat(connection, request, { ...options('hang'), timeoutMs: 350 });
  const second = runtimeChat(connection, { ...request, signal: controller.signal }, options());
  controller.abort();
  await assert.rejects(second, (e: unknown) => e instanceof RuntimeError && e.code === 'cancelled');
  await assert.rejects(first, (e: unknown) => e instanceof RuntimeError && e.code === 'timeout');
  const third = runtimeChat(connection, request, options('hang'));
  const queued = runtimeChat(connection, request, options());
  closeRuntimes();
  await assert.rejects(third); await assert.rejects(queued);
  assert.equal((await runtimeChat(connection, request, options())).text, 'risposta Codex');
});
test('runtime: ambiente depurato e server MCP ereditati disabilitati soltanto nei parametri child', () => {
  assert.deepEqual(runtimeEnvironment({ PATH: 'bin', CODEX_HOME: 'auth-place', OPENAI_API_KEY: 'secret', CODEX_THREAD_ID: 'thread', NODE_OPTIONS: 'inject', GROQ_API_KEY: 'secret' }),
    { PATH: 'bin', CODEX_HOME: 'auth-place', NO_COLOR: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' });
  const config = codexOverrides('[mcp_servers.jobfinder]\ncommand="anything"\n[profiles.work.mcp_servers.other]\ncommand="other"');
  assert.equal(config['mcp_servers.jobfinder.enabled'], false); assert.equal(config['mcp_servers.other.enabled'], false);
  assert.throws(() => codexOverrides('bad = ['), RuntimeError);
});
test('Claude opzionale: auth e completamento sintetici, nessun account reale', async () => {
  const claude: AiConnection = { ...connection, kind: 'claude', vision: false };
  assert.equal(JSON.parse((await runtimeChat(claude, { ...request, json: true }, options())).text).ok, true);
  await assert.rejects(runtimeChat(claude, request, options('api-account')), (e: unknown) => e instanceof RuntimeError && e.code === 'subscription_required');
  await assert.rejects(runtimeChat(claude, { ...request, messages: [{ role: 'user', content: [{ type: 'image', url: 'data:image/png;base64,aA==' }] }] }, options()),
    (e: unknown) => e instanceof RuntimeError && e.code === 'unsupported_capability');
});
