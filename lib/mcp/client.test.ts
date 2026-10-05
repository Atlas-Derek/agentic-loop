/**
 * Integration test: spawns the real MCP server over stdio against a temp database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../db/index';
import { createSession, getWorkflowState, listMemories } from '../db/repo';
import { callMcpTool, getMcpClient } from './client';

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

  it('runs a full workflow and reports failures', async () => {
    const created = await callMcpTool('createTask', { sessionId, title: 'Step one' });
    expect(created.ok).toBe(true);
    const taskId = (created.data as { id: number }).id;

    const early = await callMcpTool('saveSummary', { sessionId, summary: 'too soon' });
    expect(early).toMatchObject({ ok: false });
    expect(early.error).toMatch(/still open/);

    const bad = await callMcpTool('updateTaskStatus', { sessionId, taskId: 9999, status: 'done' });
    expect(bad.ok).toBe(false);

    expect((await callMcpTool('updateTaskStatus', { sessionId, taskId, status: 'done' })).ok).toBe(true);
    expect((await callMcpTool('saveSummary', { sessionId, summary: 'done' })).ok).toBe(true);
    expect(getWorkflowState(openDb(dbPath), sessionId).phase).toBe('complete');

    expect((await callMcpTool('proposeMemory', { sessionId, content: 'Likes TS', reason: 'said so' })).ok).toBe(true);
    expect(listMemories(openDb(dbPath), 'proposed')).toHaveLength(1);
  }, 20000);
});
