import { createInterface } from 'node:readline';
const scenario = process.argv[2];
const emit = (value) => process.stdout.write(JSON.stringify(value) + '\n');
if (process.argv.includes('auth') && process.argv.includes('status')) {
  emit({ loggedIn: scenario !== 'unauthenticated', authMethod: scenario === 'api-account' ? 'api_key' : 'claude.ai' });
} else if (process.argv.includes('-p')) {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  if (scenario === 'hang') await new Promise(() => {});
  else if (scenario === 'length') emit({ stop_reason: 'max_tokens', result: 'cut' });
  else emit({ subtype: 'success', structured_output: process.argv.includes('--json-schema') ? { json: '{"ok":true}' } : undefined, result: 'risposta Claude' });
} else {
  createInterface({ input: process.stdin }).on('line', (line) => {
    const message = JSON.parse(line), { id, method, params } = message;
    if (method === 'initialize') emit({ id, result: { userAgent: 'fake' } });
    if (method === 'account/read') emit({ id, result: { account: scenario === 'unauthenticated' ? null : { type: scenario === 'api-account' ? 'apiKey' : 'chatgpt' } } });
    if (method === 'model/list') emit({ id, result: { data: [{ id: 'test-model', displayName: 'Test', inputModalities: ['text', 'image'] }] } });
    if (method === 'thread/start') emit({ id, result: { thread: { id: 'thread-1' } } });
    if (method === 'turn/start') {
      emit({ id, result: { turn: { id: 'turn-1' } } });
      if (scenario === 'hang') return;
      if (scenario === 'tool') { emit({ id: 99, method: 'item/commandExecution/requestApproval', params: {} }); return; }
      if (scenario === 'tool-start') { emit({ method: 'item/started', params: { item: { type: 'commandExecution', command: 'never-run' } } }); return; }
      if (scenario === 'quota') { emit({ method: 'turn/completed', params: { turn: { status: 'failed', error: { message: 'quota usage_limit PRIVATE_SECRET' } } } }); return; }
      if (scenario === 'length') { emit({ method: 'turn/completed', params: { turn: { status: 'failed', error: { codexErrorInfo: 'contextWindowExceeded' } } } }); return; }
      const report = { ok: true, model: params.model, effort: params.effort, images: params.input.filter((p) => p.type === 'image').length,
        envClean: !process.env.OPENAI_API_KEY && !process.env.NODE_OPTIONS && !process.env.CODEX_THREAD_ID,
        cwd: process.cwd(), overrides: process.argv.filter((x, i) => process.argv[i-1] === '-c') };
      const text = scenario === 'malformed' ? '{bad' : params.outputSchema ? JSON.stringify({ json: JSON.stringify(report) }) : 'risposta Codex';
      // Chunked JSONL and commentary exercise the stream decoder and final-answer choice.
      emit({ method: 'item/completed', params: { threadId: 'thread-1', item: { type: 'agentMessage', phase: 'commentary', text: 'non finale' } } });
      const event = JSON.stringify({ method: 'item/completed', params: { threadId: 'thread-1', item: { type: 'agentMessage', phase: 'final_answer', text } } });
      process.stdout.write(event.slice(0, 9));
      process.stdout.write(event.slice(9) + '\n');
      emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
    }
  });
}
