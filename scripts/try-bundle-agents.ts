/** Verify compiled runtime/MCP modules using the bundle's Node, with isolated data. */
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { runtimeEnvironment } from '../src/ai/runtime.js';

interface Setup { command: string; args: string[]; tokenFile: string; codexConfig: string }
interface Thread { id: string; messages: { role: string; content: string }[] }
const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { 'bundle-path': { type: 'string' }, 'live-chat': { type: 'boolean', default: false } } });
  assert.ok(values['bundle-path'], 'Passare --bundle-path alla cartella estratta; lo script non modifica il pacchetto.');
  const supplied = resolve(values['bundle-path']);
  const appDir = existsSync(join(supplied, 'app', 'node.exe')) ? join(supplied, 'app') : supplied;
  const node = join(appDir, process.platform === 'win32' ? 'node.exe' : 'node');
  const sentinelFiles = ['node.exe', 'package.json', 'scripts/mcp.js', 'src/agent/mcp.js', 'src/server/app.js', 'src/ai/runtime.js', 'ui/dist/index.html'].map((file) => join(appDir, file));
  for (const file of sentinelFiles) assert.ok(existsSync(file), 'Bundle incompleto: manca un componente necessario.');
  const originalHashes = sentinelFiles.map(sha);
  const codexConfig = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'config.toml');
  const codexBefore = existsSync(codexConfig) ? sha(codexConfig) : null;
  const root = await mkdtemp(join(tmpdir(), 'housefinder-bundle-agents-'));
  const stateDir = join(root, 'state'); const dataDir = join(root, 'data'); const workDir = join(root, 'unrelated-workspace');
  await Promise.all([mkdir(stateDir), mkdir(join(dataDir, 'local'), { recursive: true }), mkdir(workDir)]);
  const fixture = async (file: string, value: unknown) => writeFile(join(dataDir, 'local', file), JSON.stringify(value), 'utf8');
  const profile = { searches: [{ id: 'synthetic', city: 'torino', label: 'Torino sintetica', maxPrice: 700 }], zones: [], musts: ['Due camere separate'], notes: 'Solo dati inventati per collaudo pacchetto.' };
  await fixture('profile.json', profile); await fixture('searches.json', profile.searches);
  await writeFile(join(dataDir, 'local', 'criteria.md'), 'CITTÀ: Torino.\nBUDGET: 700 euro.\nDue camere separate.\n');
  await fixture('providers.json', { keys: {} }); await fixture('facebook.json', { groups: [], market: [] });
  const tasks = Object.fromEntries(['scoring', 'vision', 'search', 'zones', 'chat'].map((task) => [task, { connectionId: 'codex', fallbackIds: [] }]));
  await fixture('ai-connections.json', { version: 1, connections: [{ id: 'codex', label: 'Codex test sintetico', kind: 'codex', model: process.env.HOUSE_MCP_MODEL ?? 'gpt-6.1-sol', reasoning: 'low', enabled: true, vision: true }], tasks });
  const listing = { key: 'subito:bundle-synthetic-1', listing: { source: 'subito', id: 'bundle-synthetic-1', title: 'Bilocale sintetico Torino', zone: 'Torino', price: 650, url: 'https://example.invalid/bundle-house', desc: 'Casa inventata, arredata, con due camere separate.' }, ai: null, fields: null, visionSummary: null, photos: [], channel: 'subito', firstSeen: '2026-11-03T12:00:00Z', lastSeen: '2026-11-03T12:00:00Z', status: 'new', notified: false };
  const archive = join(stateDir, 'listings.json');
  await writeFile(archive, JSON.stringify({ [listing.key]: listing }, null, 2));
  const archiveBefore = sha(archive);
  const env = runtimeEnvironment();
  for (const key of Object.keys(env)) if (/API_KEY|TOKEN|PASS|IMAP_|TELEGRAM/i.test(key)) delete env[key];
  Object.assign(env, { DATA_DIR: dataDir, STATE_DIR: stateDir, LISTINGS_PATH: archive, FB_STATE_PATH: join(stateDir, 'fb.json'), THUMBS_DIR: join(stateDir, 'thumbs') });
  const moduleUrl = (relative: string): string => pathToFileURL(join(appDir, relative)).href;
  const host = join(root, 'bundle-host.mjs');
  await writeFile(host, `
    const [{ ListingStore }, { createApp }] = await Promise.all([
      import(${JSON.stringify(moduleUrl('src/core/store.js'))}), import(${JSON.stringify(moduleUrl('src/server/app.js'))})]);
    const store = await ListingStore.load(process.env.LISTINGS_PATH, { exclusive: true });
    let server;
    const stop = () => { app.locals.closeAi?.(); server.close(() => { store.close(); process.exit(0); }); };
    const app = createApp({ store, stateDir: process.env.STATE_DIR, onShutdown: stop,
      checkUpdate: async () => ({ checked: true, current: 'fixture', latest: null, updateAvailable: false, asset: null, notes: '', releaseUrl: null, frozen: false, detail: null }),
      runPipeline: async (channels) => ({ runId: 'fixture', channels, results: [], startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), outcome: 'succeeded' }) });
    server = app.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ ready: true, url: 'http://127.0.0.1:' + server.address().port, node: process.version })));
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  `, 'utf8');
  let child: ChildProcessWithoutNullStreams | undefined; let client: Client | undefined;
  let base = '';
  let uiHeaders: Record<string, string> = {};
  const report: Record<string, unknown> = { ok: false, artifacts: root, bundle: appDir, synthetic: true, liveChatRequested: values['live-chat'], checks: [] };
  const checks = report.checks as string[];
  const api = async <T>(path: string, method = 'GET', body?: unknown, headers = uiHeaders): Promise<T> => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(values['live-chat'] ? 180_000 : 40_000) });
    if (!response.ok) { const failure = await response.json().catch(() => ({})) as { error?: string; code?: string }; throw new Error(`bundle_http_${response.status}_${failure.error ?? failure.code ?? 'failed'}`); }
    return response.json() as Promise<T>;
  };
  try {
    child = spawn(node, [host], { cwd: workDir, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stderr.resume();
    const ready = await new Promise<{ url: string; node: string }>((resolveReady, reject) => {
      const timeout = setTimeout(() => reject(new Error('bundle_start_timeout')), 40_000);
      let buffered = '';
      child!.stdout.setEncoding('utf8');
      child!.stdout.on('data', (chunk: string) => {
        buffered += chunk; let index: number;
        while ((index = buffered.indexOf('\n')) >= 0) {
          const line = buffered.slice(0, index); buffered = buffered.slice(index + 1);
          try { const parsed = JSON.parse(line); if (parsed.ready) { clearTimeout(timeout); resolveReady(parsed); } } catch { /* regular app log */ }
        }
      });
      child!.once('error', () => { clearTimeout(timeout); reject(new Error('bundle_start_failed')); });
      child!.once('close', () => { clearTimeout(timeout); reject(new Error('bundle_closed_before_ready')); });
    });
    base = ready.url; report.node = ready.node;
    const noSession = await fetch(`${base}/api/ai/connections`); assert.equal(noSession.status, 403);
    const bootstrap = await fetch(`${base}/api/agent/ui/session`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', 'X-HouseFinder-UI': '1' }, body: '{}' });
    assert.equal(bootstrap.status, 200); const { csrfToken } = await bootstrap.json() as { csrfToken: string };
    const cookie = bootstrap.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
    uiHeaders = { Origin: base, Cookie: cookie, 'X-HouseFinder-CSRF': csrfToken };
    checks.push('bundle_node_compiled_app_and_ui_session');
    const meta = await api<{ version: string }>('/api/meta'); report.version = meta.version;
    const html = await (await fetch(base)).text(); assert.ok(html.includes('<html') && html.includes('/assets/'));
    checks.push('packaged_ui_present');
    const diagnostics = await api<{ ready: boolean; authenticated: boolean; code?: string }>('/api/ai/connections/codex/diagnostics');
    report.runtimeDiagnostics = { ready: diagnostics.ready, authenticated: diagnostics.authenticated, code: diagnostics.code };
    assert.equal(diagnostics.authenticated, true, 'bundle_native_auth_unavailable');
    assert.equal(sha(archive), archiveBefore); checks.push('native_account_diagnostics_without_completion');
    const setup = await api<Setup>('/api/agent/setup', 'POST', {});
    assert.equal(resolve(setup.command), resolve(node)); assert.ok(setup.args.some((arg) => resolve(arg) === join(appDir, 'scripts', 'mcp.js')));
    const token = (await readFile(setup.tokenFile, 'utf8')).trim(); assert.ok(!setup.codexConfig.includes(token));
    client = new Client({ name: 'house-bundle-verifier', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: setup.command, args: setup.args, cwd: workDir, stderr: 'pipe' }));
    const tools = await client.listTools(); assert.equal(tools.tools.length, 10);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result = await client!.callTool({ name, arguments: args }); assert.ok(!result.isError, `bundle_mcp_${name}_failed`);
      const content = result.content?.find((entry) => entry.type === 'text'); assert.ok(content && content.type === 'text');
      return JSON.parse(content.text);
    };
    await call('housefinder_health');
    assert.equal((await call('housefinder_list_listings', { limit: 1 })).total, 1);
    assert.equal((await call('housefinder_get_listing', { key: listing.key })).listing.title, listing.listing.title);
    assert.equal((await call('housefinder_get_stats')).total, 1);
    await call('housefinder_get_profile'); await call('housefinder_get_run');
    await call('housefinder_set_status', { key: listing.key, status: 'favorite', requestId: 'bundle-favorite' });
    await call('housefinder_set_status', { key: listing.key, status: 'new', requestId: 'bundle-restore' });
    const proposed = await call('housefinder_propose_profile', { profile, requestId: 'bundle-profile-proposal' });
    assert.equal(proposed.state, 'pending');
    assert.equal((await call('housefinder_get_operation', { operationId: proposed.id })).state, 'pending');
    const capabilityOnly = await fetch(`${base}/api/agent/proposals/${proposed.id}/confirm`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{}' }); assert.equal(capabilityOnly.status, 403);
    assert.equal((await api<{ state: string }>(`/api/agent/proposals/${proposed.id}/confirm`, 'POST', {})).state, 'confirmed');
    checks.push('bundle_stdio_mcp_from_other_cwd_and_human_approval');
    const beforeChat = JSON.parse(await readFile(archive, 'utf8'));
    assert.equal(beforeChat[listing.key].status, 'new'); assert.equal(Object.keys(beforeChat).length, 1);
    if (values['live-chat']) {
      const thread = await api<Thread>('/api/chat/threads', 'POST', {});
      const result = await api<Thread>(`/api/chat/threads/${thread.id}/messages`, 'POST', { text: 'Usa soltanto questo annuncio inventato. Indica prezzo e cosa sappiamo delle camere in una sola frase breve, senza strumenti o azioni.', keys: [listing.key] });
      assert.equal(result.messages.filter((message) => message.role === 'assistant').length, 1);
      const answer = result.messages.find((message) => message.role === 'assistant')!.content;
      assert.ok(answer.includes('650')); report.chatAnswerValidated = true;
      assert.equal(await readFile(archive, 'utf8'), JSON.stringify(beforeChat, null, 2) + '\n');
      checks.push('bundle_native_codex_chat_synthetic');
    }
    assert.deepEqual(sentinelFiles.map(sha), originalHashes);
    assert.equal(existsSync(codexConfig) ? sha(codexConfig) : null, codexBefore);
    checks.push('bundle_and_global_codex_configuration_unchanged'); report.ok = true;
  } catch (error) {
    report.error = error instanceof Error ? error.message.slice(0, 200) : 'bundle_agents_failed';
    throw error;
  } finally {
    await client?.close().catch(() => {});
    if (child && child.exitCode === null) {
      if (base) await fetch(`${base}/api/system/shutdown`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
      await new Promise<void>((done) => { const timer = setTimeout(() => { child!.kill(); done(); }, 5000); child!.once('close', () => { clearTimeout(timer); done(); }); });
    }
    report.globalConfigurationPreserved = (existsSync(codexConfig) ? sha(codexConfig) : null) === codexBefore;
    await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2));
    await rm(stateDir, { recursive: true, force: true }); await rm(dataDir, { recursive: true, force: true });
    console.log(JSON.stringify(report, null, 2));
  }
}
void main().catch(() => { process.exitCode = 1; });
