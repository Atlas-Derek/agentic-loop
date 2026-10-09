/**
 * Integration test: spawns the real MCP server over stdio against a temp database.
 * Task/workflow rules are covered in lib/db/repo.test.ts; this file covers what the MCP layer adds:
 * tool registration, input validation (TEXT_LIMITS), error mapping and the child process environment.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../db/index';
import { createSession, getWorkflowState, listMemories, listTasks } from '../db/repo';
import { callMcpTool, getMcpClient, serverEnv } from './client';
import { TEXT_LIMITS } from './schemas';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mcp-'));
const dbPath = path.join(dir, 'test.db');
let sessionId: string;

beforeAll(() => {
  process.env.AGENT_DB_PATH = dbPath; // inherited by the spawned server
  sessionId = createSession(openDb(dbPath), { provider: 'openai', model: 'gpt-5-mini' }).id;
});

afterAll(async () => {
  await (await getMcpClient()).close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('MCP workflow server', () => {
  it('lists the five tools', async () => {
    const { tools } = await (await getMcpClient()).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['createTask', 'listTasks', 'proposeMemory', 'saveSummary', 'updateTaskStatus']);
  }, 20000);

  it('runs a workflow to completion and maps domain errors to ok=false with the message', async () => {
    const created = await callMcpTool('createTask', { sessionId, title: 'Step one' });
    expect(created.ok).toBe(true);
    const taskId = (created.data as { id: number }).id;

    expect(await callMcpTool('updateTaskStatus', { sessionId, taskId: 9999, status: 'done' })).toEqual({
      ok: false,
      data: { error: 'Task 9999 not found in this session' },
      error: 'Task 9999 not found in this session',
    });

    expect((await callMcpTool('updateTaskStatus', { sessionId, taskId, status: 'done' })).ok).toBe(true);
    expect(await callMcpTool('saveSummary', { sessionId, summary: 'done' })).toMatchObject({ ok: true, data: { saved: true, workflow: 'complete' } });
    expect(getWorkflowState(openDb(dbPath), sessionId).phase).toBe('complete');

    expect((await callMcpTool('proposeMemory', { sessionId, content: 'Likes TS', reason: 'said so' })).ok).toBe(true);
    expect(listMemories(openDb(dbPath), 'proposed')).toHaveLength(1);
  }, 20000);

  it('rejects over-long model-written text before it reaches the database', async () => {
    const other = createSession(openDb(dbPath), { provider: 'openai', model: 'gpt-5-mini' }).id;
    const tooLong = (limit: number) => 'x'.repeat(limit + 1);

    const cases: [string, Record<string, unknown>][] = [
      ['createTask', { title: tooLong(TEXT_LIMITS.title) }],
      ['createTask', { title: 'ok', description: tooLong(TEXT_LIMITS.description) }],
      ['updateTaskStatus', { taskId: 1, status: 'done', note: tooLong(TEXT_LIMITS.note) }],
      ['saveSummary', { summary: tooLong(TEXT_LIMITS.summary) }],
      ['proposeMemory', { content: tooLong(TEXT_LIMITS.memory), reason: 'r' }],
      ['proposeMemory', { content: 'ok', reason: tooLong(TEXT_LIMITS.reason) }],
    ];
    for (const [name, args] of cases) {
      const res = await callMcpTool(name, { sessionId: other, ...args });
      expect([name, Object.keys(args), res.ok, res.error]).toEqual([name, Object.keys(args), false, expect.stringMatching(/Input validation error/)]);
    }

    const db = openDb(dbPath);
    expect(listTasks(db, other)).toEqual([]);
    expect(listMemories(db).filter((m) => m.sourceSessionId === other)).toEqual([]);
  }, 20000);
});

describe('serverEnv', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('passes the DB path to the tool server but no API keys or the app password', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-secret-openai');
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'secret-google');
    vi.stubEnv('APP_PASSWORD', 'secret-password');
    vi.stubEnv('AGENT_DB_PATH', '/tmp/agent.db');

    const env = serverEnv();
    expect(env.AGENT_DB_PATH).toBe('/tmp/agent.db');
    expect(Object.values(env)).not.toEqual(expect.arrayContaining([expect.stringMatching(/secret/)]));
  });
});
