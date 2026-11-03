/** STDIO proxy only: the application keeps sole ownership of listings/state. */
import { readFile, lstat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createAgentMcpServer } from '../src/agent/mcp.js';
import { AgentError } from '../src/agent/service.js';

export function validateAppUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new AgentError('invalid_app_url'); }
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new AgentError('invalid_app_url');
  return url.origin;
}

export async function createRemoteDispatch(urlValue: string, tokenFile: string): Promise<(name: string, args: unknown) => Promise<unknown>> {
  const url = validateAppUrl(urlValue);
  const path = resolve(tokenFile);
  try {
    if ((await lstat(path)).isSymbolicLink() || (await lstat(dirname(path))).isSymbolicLink()) throw new Error();
  } catch { throw new AgentError('invalid_agent_token_file'); }
  let token: string;
  try { token = (await readFile(path, 'utf8')).trim(); } catch { throw new AgentError('invalid_agent_token_file'); }
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) throw new AgentError('invalid_agent_token_file');
  return async (name, args) => {
    const target = new URL(`${url}/api/agent/tools/${encodeURIComponent(name)}`);
    // Native HTTP never inherits environment proxy configuration or follows redirects.
    const response = await new Promise<{ status: number; text: string }>((resolveResponse, reject) => {
      const req = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(30_000),
      }, (res) => {
        const chunks: Buffer[] = []; let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 4 * 1024 * 1024) { req.destroy(); reject(new AgentError('housefinder_response_too_large', 502)); }
          else chunks.push(chunk);
        });
        res.once('end', () => resolveResponse({ status: res.statusCode ?? 502, text: Buffer.concat(chunks).toString('utf8') }));
        res.once('error', () => reject(new AgentError('housefinder_unreachable_open_the_local_app', 503)));
      });
      req.once('error', () => reject(new AgentError('housefinder_unreachable_open_the_local_app', 503)));
      req.end(JSON.stringify({ arguments: args }));
    });
    let body: unknown;
    try { body = JSON.parse(response.text); } catch { throw new AgentError('housefinder_invalid_response', 502); }
    if (response.status < 200 || response.status >= 300) {
      const code = body && typeof body === 'object' && 'error' in body ? String(body.error) : '';
      throw new AgentError(/^[a-z][a-z0-9_]{0,99}$/.test(code) ? code : 'housefinder_request_failed', response.status);
    }
    return body;
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { url: { type: 'string' }, 'token-file': { type: 'string' } } });
  if (!values.url || !values['token-file']) throw new AgentError('mcp_url_and_token_file_required');
  const dispatch = await createRemoteDispatch(values.url, values['token-file']);
  const handle = serveStdio(() => createAgentMcpServer(dispatch));
  process.once('SIGINT', () => { void handle.close(); });
  process.once('SIGTERM', () => { void handle.close(); });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch((error) => { console.error(error instanceof AgentError ? error.code : 'housefinder_mcp_start_failed'); process.exitCode = 1; });
}
