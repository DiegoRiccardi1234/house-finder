import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import express from 'express';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { ListingStore } from '../src/core/store.js';
import { createAgentRouter } from '../src/server/agentRoutes.js';
import { AgentError, type AgentOperation } from '../src/agent/service.js';
import type { Profile } from '../src/config/profile.js';
import { createRemoteDispatch, validateAppUrl } from '../scripts/mcp.js';

const initialProfile: Profile = { searches: [{ id: 'torino', city: 'torino', label: 'Torino', maxPrice: 700 }], zones: [], musts: [], notes: 'Due camere separate' };

async function fixture(t: TestContext, beforeProfileSave?: () => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'housefinder-agent-'));
  const store = await ListingStore.load(join(root, 'listings.json'));
  store.upsert({ source: 'subito', id: '1', title: 'Bilocale Torino', zone: 'Torino', price: 600, url: 'https://example.invalid/1', desc: 'Dati di prova' }, new Date().toISOString());
  await store.save();
  let busy = false; let scans = 0; let saves = 0; let profile = structuredClone(initialProfile);
  const agent = createAgentRouter({ store, stateDir: root, isBusy: () => busy || store.isMutating,
    getRunStatus: () => ({ running: busy, runId: null, channels: [], startedAt: null, summary: { outcome: 'failed', results: [{ errors: ['private native error'] }] } }),
    startScan: (channels) => { assert.deepEqual(channels, ['subito']); scans++; return 'run-test'; },
    getProfile: () => profile,
    saveProfile: async (next) => { saves++; await beforeProfileSave?.(); profile = structuredClone(next); },
  });
  const app = express(); app.use(express.json()); app.use('/api/agent', agent.router); app.use('/mcp', agent.mcpHandler);
  app.post('/shared-ui', agent.requireUi, (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); store.close(); await rm(root, { recursive: true, force: true }); });
  const api = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => fetch(`${base}${path}`, {
    method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ui = async () => {
    const response = await api('/api/agent/ui/session', 'POST', {}, { Origin: base, 'X-HouseFinder-UI': '1' });
    assert.equal(response.status, 200); const body = await response.json() as { csrfToken: string };
    const cookie = response.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
    return { Origin: base, Cookie: cookie, 'X-HouseFinder-CSRF': body.csrfToken };
  };
  const setup = async () => {
    const headers = await ui(); const response = await api('/api/agent/setup', 'POST', {}, headers);
    assert.equal(response.status, 200);
    const config = await response.json() as { tokenFile: string; command: string; args: string[]; codexConfig: string };
    const token = await readFile(config.tokenFile, 'utf8');
    return { config, token, headers };
  };
  return { root, store, agent, base, api, ui, setup, setBusy: (next: boolean) => { busy = next; }, scans: () => scans, saves: () => saves,
    replaceProfile: (next: Profile) => { profile = next; } };
}

test('agent setup is explicit, secrets stay in private token file, and config works across folders', async (t) => {
  const f = await fixture(t);
  assert.equal(existsSync(f.agent.service.tokenFile), false);
  const noUi = await f.api('/api/agent/setup', 'POST', {}); assert.equal(noUi.status, 403);
  assert.equal(existsSync(f.agent.service.tokenFile), false);
  const { config, token } = await f.setup();
  assert.ok(config.codexConfig.includes('mcp_servers.housefinder'));
  assert.ok(!config.codexConfig.includes(token));
  assert.ok(config.args.includes(f.agent.service.tokenFile));
  const second = await f.setup(); assert.equal(second.token, token);
  assert.equal(f.store.size, 1);
});

test('agent cookie, exact Origin, CSRF and capability are separate', async (t) => {
  const f = await fixture(t); const { token, headers } = await f.setup();
  const bearer = { Authorization: `Bearer ${token}` };
  assert.equal((await f.api('/api/agent/proposals', 'GET', undefined, bearer)).status, 403);
  assert.equal((await f.api('/api/agent/ui/session', 'POST', {}, { ...bearer, Origin: f.base, 'X-HouseFinder-UI': '1' })).status, 403);
  assert.equal((await f.api('/shared-ui', 'POST', {}, { Cookie: headers.Cookie, Origin: f.base })).status, 403);
  assert.equal((await f.api('/shared-ui', 'POST', {}, { ...headers, Origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await f.api('/shared-ui', 'POST', {}, headers)).status, 200);
  const forbiddenStatus = await new Promise<number>((resolve, reject) => {
    const req = request(`${f.base}/api/agent/tools/housefinder_health`, { method: 'POST', headers: { ...bearer, Host: 'evil.invalid', 'Content-Type': 'application/json' } }, (res) => { res.resume(); res.once('end', () => resolve(res.statusCode!)); });
    req.once('error', reject); req.end('{}');
  });
  assert.equal(forbiddenStatus, 403);
  assert.equal((await f.api('/api/agent/tools/housefinder_health', 'POST', {}, { ...bearer, Origin: 'http://localhost:1' })).status, 403);
});

test('agent status writes are durable, reversible, idempotent and block during runs', async (t) => {
  const f = await fixture(t);
  const args = { key: 'subito:1', status: 'favorite', requestId: 'status-1' };
  const result = await f.agent.service.dispatch('housefinder_set_status', args) as AgentOperation;
  assert.equal(result.state, 'completed'); assert.equal(f.store.get('subito:1')?.status, 'favorite');
  assert.deepEqual(await f.agent.service.dispatch('housefinder_set_status', args), result);
  await assert.rejects(f.agent.service.dispatch('housefinder_set_status', { ...args, status: 'dismissed' }), /request_id_conflict/);
  f.setBusy(true);
  await assert.rejects(f.agent.service.dispatch('housefinder_set_status', { ...args, requestId: 'status-2' }), /archive_busy/);
  f.setBusy(false);
  await f.agent.service.dispatch('housefinder_set_status', { ...args, status: 'new', requestId: 'status-3' });
  assert.equal(f.store.get('subito:1')?.status, 'new');
  const disk = JSON.parse(await readFile(join(f.root, 'listings.json'), 'utf8')) as Record<string, { status: string }>;
  assert.equal(disk['subito:1'].status, 'new');
});

test('scan is only proposed by MCP and can only be started by a browser approval', async (t) => {
  const f = await fixture(t); const { token, headers } = await f.setup();
  const proposal = await f.agent.service.dispatch('housefinder_propose_scan', { channels: ['subito'], requestId: 'scan-1' }) as AgentOperation;
  assert.equal(proposal.state, 'pending'); assert.equal(f.scans(), 0);
  assert.equal((await f.api(`/api/agent/proposals/${proposal.id}/confirm`, 'POST', {}, { Authorization: `Bearer ${token}`, Origin: f.base })).status, 403);
  const response = await f.api(`/api/agent/proposals/${proposal.id}/confirm`, 'POST', {}, headers);
  assert.equal(response.status, 200); assert.equal(f.scans(), 1);
  assert.equal((await f.api(`/api/agent/proposals/${proposal.id}/confirm`, 'POST', {}, headers)).status, 200);
  assert.equal(f.scans(), 1);
  const json = await (await f.api('/api/agent/proposals', 'GET', undefined, headers)).json() as { proposals: unknown[] };
  assert.equal(json.proposals.length, 0);
});

test('profile proposals reject stale context and require explicit UI confirmation', async (t) => {
  const f = await fixture(t); const next = { ...initialProfile, notes: 'Nuova preferenza' };
  const row = await f.agent.service.dispatch('housefinder_propose_profile', { profile: next, requestId: 'profile-1' }) as AgentOperation;
  assert.equal(f.saves(), 0);
  f.replaceProfile({ ...initialProfile, notes: 'Modifica concorrente' });
  await assert.rejects(f.agent.service.decide(row.id, true), /profile_changed_propose_again/);
  assert.equal(f.saves(), 0);
  const second = await f.agent.service.dispatch('housefinder_propose_profile', { profile: next, requestId: 'profile-2' }) as AgentOperation;
  await f.agent.service.decide(second.id, true); assert.equal(f.saves(), 1);
  await f.agent.service.decide(row.id, false); assert.equal(f.saves(), 1);
});

test('agent restart never automatically repeats an uncertain operation or resets invalid history', async (t) => {
  const f = await fixture(t);
  const row = await f.agent.service.dispatch('housefinder_propose_scan', { channels: ['subito'], requestId: 'interrupted' }) as AgentOperation;
  const journal = JSON.parse(await readFile(f.agent.service.journalFile, 'utf8')) as { operations: AgentOperation[] };
  journal.operations[0].state = 'applying'; await writeFile(f.agent.service.journalFile, JSON.stringify({ ...journal, version: 1 }));
  const recovered = await f.agent.service.dispatch('housefinder_get_operation', { operationId: row.id }) as AgentOperation;
  assert.equal(recovered.state, 'interrupted'); assert.equal(f.scans(), 0);
  await assert.rejects(f.agent.service.decide(row.id, true), /proposal_not_pending/);
  await writeFile(f.agent.service.journalFile, 'broken-json');
  await assert.rejects(f.agent.service.proposals(), /agent_journal_invalid/);
  assert.equal(await readFile(f.agent.service.journalFile, 'utf8'), 'broken-json');
});

test('profile application exposes its busy guard for the ordinary scan and config routes', async (t) => {
  let enter!: () => void; let finish!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  const f = await fixture(t, async () => { enter(); await gate; });
  const row = await f.agent.service.dispatch('housefinder_propose_profile', { profile: initialProfile, requestId: 'profile-guard' }) as AgentOperation;
  assert.equal(f.agent.service.isApplying, false);
  const decision = f.agent.service.decide(row.id, true);
  await entered;
  assert.equal(f.agent.service.isApplying, true);
  finish();
  assert.equal((await decision).state, 'confirmed');
  assert.equal(f.agent.service.isApplying, false);
});

test('status save failure restores the existing store and records an explicit failed operation', async (t) => {
  const f = await fixture(t); const originalSave = f.store.save.bind(f.store);
  f.store.save = async () => { throw new Error('private filesystem error'); };
  await assert.rejects(f.agent.service.dispatch('housefinder_set_status', { key: 'subito:1', status: 'favorite', requestId: 'failing-save' }), /operation_failed_check_state/);
  assert.equal(f.store.get('subito:1')?.status, 'new');
  const journal = await readFile(f.agent.service.journalFile, 'utf8');
  assert.ok(!journal.includes('private filesystem error')); assert.ok(journal.includes('failed'));
  f.store.save = originalSave;
});

test('agent reads bounded data and exposes no generic execution or raw run errors', async (t) => {
  const f = await fixture(t);
  const rows = await f.agent.service.dispatch('housefinder_list_listings', { city: 'Torino', limit: 1 }) as { total: number; listings: unknown[] };
  assert.equal(rows.total, 1); assert.equal(rows.listings.length, 1);
  assert.ok(!JSON.stringify(await f.agent.service.dispatch('housefinder_get_run', {})).includes('private native error'));
  for (const name of ['constructor', '__proto__', 'reset', 'exec', 'approve', 'read_file']) await assert.rejects(f.agent.service.dispatch(name, {}), /unknown_tool/);
  await assert.rejects(f.agent.service.dispatch('housefinder_list_listings', { limit: 101 }), /invalid_tool_arguments/);
  await assert.rejects(f.agent.service.dispatch('housefinder_propose_scan', { channels: ['subito', 'subito'], requestId: 'duplicate' }), /invalid_tool_arguments/);
  assert.equal(f.scans(), 0);
});

test('official MCP HTTP client negotiates legacy and auto discovery and receives controlled tool errors', async (t) => {
  const f = await fixture(t); const { token } = await f.setup();
  for (const mode of ['legacy', 'auto'] as const) {
    const client = new Client({ name: 'house-test', version: '1.0.0' }, { versionNegotiation: { mode } });
    const transport = new StreamableHTTPClientTransport(new URL(`${f.base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
    await client.connect(transport);
    try {
      const tools = await client.listTools(); assert.equal(tools.tools.length, 10);
      assert.ok(!tools.tools.some((tool) => /confirm|approve|reset|delete|credential/.test(tool.name)));
      const health = await client.callTool({ name: 'housefinder_health', arguments: {} }); assert.ok(!health.isError);
      const missing = await client.callTool({ name: 'housefinder_get_listing', arguments: { key: 'missing' } });
      assert.equal(missing.isError, true); assert.ok(JSON.stringify(missing).includes('listing_not_found'));
    } finally { await client.close(); }
  }
});

test('official MCP STDIO client runs from another folder and reports app closed without starting a writer', async (t) => {
  const f = await fixture(t); const { config } = await f.setup();
  const client = new Client({ name: 'house-stdio-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: config.command, args: config.args, cwd: tmpdir(), stderr: 'pipe' });
  await client.connect(transport);
  try {
    const tools = await client.listTools(); assert.equal(tools.tools.length, 10);
    const result = await client.callTool({ name: 'housefinder_list_listings', arguments: { limit: 1 } });
    assert.ok(!result.isError); assert.ok(JSON.stringify(result).includes('Bilocale Torino'));
  } finally { await client.close(); }
  assert.equal(f.store.size, 1); assert.equal(f.scans(), 0);
  const offline = await createRemoteDispatch('http://127.0.0.1:1', config.tokenFile);
  await assert.rejects(offline('housefinder_health', {}), /housefinder_unreachable_open_the_local_app/);
});

test('MCP proxy refuses non-loopback, user-info and redirectable app URLs', () => {
  for (const url of ['https://example.com', 'http://127.0.0.1.evil.invalid', 'http://user:pass@127.0.0.1', 'http://127.0.0.1/path', 'file:///tmp/a', 'http://127.0.0.1?token=a']) {
    assert.throws(() => validateAppUrl(url), AgentError);
  }
  assert.equal(validateAppUrl('http://127.0.0.1:3000/'), 'http://127.0.0.1:3000');
});
