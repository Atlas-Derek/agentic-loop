/**
 * End-to-end test of the agent loop without a real LLM:
 * mock model -> streamText -> AI SDK tool wrapper -> real MCP server (stdio) -> SQLite,
 * then persistence, history round-trip and compaction.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test';
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-route-'));
process.env.AGENT_DB_PATH = path.join(dir, 'test.db');
process.env.COMPACT_AFTER = '3';
process.env.KEEP_RECENT = '2';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const finish = (unified: 'stop' | 'tool-calls'): LanguageModelV4StreamPart => ({ type: 'finish', usage, finishReason: { unified, raw: unified } });
const text = (t: string): LanguageModelV4StreamPart[] => [
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta: t },
  { type: 'text-end', id: 't' },
];
const stream = (parts: LanguageModelV4StreamPart[]) => ({ stream: convertArrayToReadableStream(parts) });

// Scripted model: turn 1 = tool call then text; turns 2 and 3 = text. doGenerate = compaction summary.
const mockModel = new MockLanguageModelV4({
  doStream: [
    stream([{ type: 'stream-start', warnings: [] }, { type: 'tool-call', toolCallId: 'c1', toolName: 'createTask', input: '{"title":"Pick venue"}' }, finish('tool-calls')]),
    stream([{ type: 'stream-start', warnings: [] }, ...text('Created your plan.'), finish('stop')]),
    stream([{ type: 'stream-start', warnings: [] }, ...text('Sounds good.'), finish('stop')]),
    stream([{ type: 'stream-start', warnings: [] }, ...text('Carrying on.'), finish('stop')]),
  ],
  doGenerate: async () => ({
    content: [{ type: 'text', text: '### User goal\nPlan an offsite' }],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage,
    warnings: [],
  }),
});

vi.mock('@/lib/agent/model', () => ({
  getModel: () => mockModel,
  configuredProviders: () => ({ openai: true, google: true }),
}));

const { POST } = await import('./route');
const { getDb } = await import('@/lib/db');
const repo = await import('@/lib/db/repo');
const { getMcpClient } = await import('@/lib/mcp/client');

let sessionId: string;

const post = (body: unknown): Promise<Response> =>
  POST(new Request('http://test/api/chat', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }));

const userMessage = (id: string, t: string) => ({ id, role: 'user', parts: [{ type: 'text', text: t }] });

async function send(id: string, t: string): Promise<void> {
  const res = await post({ sessionId, provider: 'openai', model: 'gpt-5-mini', message: userMessage(id, t) });
  expect(res.status).toBe(200);
  await res.text(); // drain the stream so onEnd runs
  await new Promise((r) => setTimeout(r, 50));
}

beforeAll(() => {
  sessionId = repo.createSession(getDb(), { provider: 'openai', model: 'gpt-5-mini' }).id;
});

afterAll(async () => {
  await (await getMcpClient()).close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('POST /api/chat', () => {
  it('calls an MCP tool, logs it, and persists the conversation', async () => {
    await send('u1', 'Help me plan an offsite');
    const db = getDb();

    expect(repo.listTasks(db, sessionId).map((t) => t.title)).toEqual(['Pick venue']);
    const [call] = repo.listToolCalls(db, sessionId);
    expect(call).toMatchObject({ toolName: 'createTask', input: { title: 'Pick venue' }, success: true });

    const msgs = repo.getMessages(db, sessionId);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(msgs[1].parts.some((p) => p.type === 'tool-createTask')).toBe(true);
    expect(repo.getSession(db, sessionId)?.title).toBe('Help me plan an offsite');
  }, 30000);

  it('replays history with tool results, includes task state in instructions, and compacts', async () => {
    await send('u2', 'Great');
    const db = getDb();

    // Third model call = turn 2. Its prompt must include the stored tool result and live task list.
    const prompt = JSON.stringify(mockModel.doStreamCalls[2].prompt);
    expect(prompt).toContain('Pick venue');
    expect(prompt).toContain('#1 [pending] Pick venue');

    // 4 messages > COMPACT_AFTER(3): the first two are compacted and summarised.
    expect(repo.getLatestSummary(db, sessionId, 'compaction')?.content).toContain('Plan an offsite');
    expect(repo.getMessages(db, sessionId).map((m) => m.id)).toEqual(['u2', expect.any(String)]);
    expect(repo.getMessages(db, sessionId, { includeCompacted: true })).toHaveLength(4);
  }, 30000);

  it('feeds the compaction summary as tagged context, not system instructions', async () => {
    await send('u3', 'Next');
    const prompt = mockModel.doStreamCalls[3].prompt;
    const system = prompt.filter((m) => m.role === 'system').map((m) => JSON.stringify(m.content)).join('');
    expect(system).toContain('#1 [pending] Pick venue');
    expect(system).not.toContain('Plan an offsite');
    expect(prompt[1].role).toBe('user');
    expect(JSON.stringify(prompt[1].content)).toContain('<conversation_summary>');
  }, 30000);

  it('rejects requests that are not a single plain-text user message', async () => {
    const before = repo.getMessages(getDb(), sessionId, { includeCompacted: true }).length;
    const base = { sessionId, provider: 'openai', model: 'gpt-5-mini' };

    expect((await post('not json')).status).toBe(400);
    expect((await post({ ...base })).status).toBe(400);
    expect((await post({ ...base, message: { ...userMessage('x1', 'hi'), role: 'assistant' } })).status).toBe(400);
    const fakeTool = { id: 'x2', role: 'user', parts: [{ type: 'tool-createTask', toolCallId: 'c', state: 'output-available', input: {}, output: { id: 1 } }] };
    expect((await post({ ...base, message: fakeTool })).status).toBe(400);
    expect((await post({ ...base, provider: 'nope', message: userMessage('x3', 'hi') })).status).toBe(400);
    // Reusing a stored id would overwrite history.
    expect((await post({ ...base, message: userMessage('u1', 'rewritten') })).status).toBe(409);

    const all = repo.getMessages(getDb(), sessionId, { includeCompacted: true });
    expect(all).toHaveLength(before);
    expect(all.find((m) => m.id === 'u1')?.parts).toEqual([{ type: 'text', text: 'Help me plan an offsite' }]);
  });
});
