import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolSet } from 'ai';
import { openDb, type DB } from '../db/index';
import * as repo from '../db/repo';
import { buildWorkflowTools, capToolOutput, MAX_TOOL_OUTPUT_CHARS, type WorkflowToolDeps } from './tools';

describe('capToolOutput', () => {
  it('passes small results through unchanged', () => {
    const out = { id: 1, title: 'Pick venue' };
    expect(capToolOutput(out, 100)).toBe(out);
    expect(capToolOutput(undefined, 100)).toBeUndefined();
  });

  it('replaces large results with a marked, bounded preview', () => {
    const big = { tasks: Array.from({ length: 50 }, (_, i) => ({ id: i, title: `Task ${i}` })) };
    const capped = capToolOutput(big, 100) as { truncated: boolean; note: string; preview: string };
    expect(capped.truncated).toBe(true);
    expect(capped.preview).toHaveLength(100);
    expect(capped.note).toMatch(/only the first 100/);
  });
});

describe('buildWorkflowTools', () => {
  let db: DB;
  let sessionId: string;

  beforeEach(() => {
    db = openDb(':memory:');
    sessionId = repo.createSession(db, { provider: 'openai', model: 'gpt-5-mini' }).id;
  });

  const fakeMcp = (impl: WorkflowToolDeps['callMcpTool']) => vi.fn(impl);
  const build = (callMcpTool: WorkflowToolDeps['callMcpTool']): ToolSet => buildWorkflowTools(sessionId, { getDb: () => db, callMcpTool });
  const run = (tools: ToolSet, name: string, input: Record<string, unknown>, abortSignal?: AbortSignal): Promise<unknown> =>
    Promise.resolve(tools[name].execute?.(input, { toolCallId: 'call-1', messages: [], context: undefined, abortSignal }));

  it('injects the session id over any the model sends, forwards the abort signal, and logs the call', async () => {
    const call = fakeMcp(async () => ({ ok: true, data: { id: 7, title: 'Pick venue' }, error: null }));
    const stop = new AbortController();
    // The AI SDK strips unknown keys before execute; this checks the wrapper doesn't rely on that alone.
    const out = await run(build(call), 'createTask', { title: 'Pick venue', sessionId: 'someone-else' }, stop.signal);

    expect(call).toHaveBeenCalledWith('createTask', { title: 'Pick venue', sessionId }, { signal: stop.signal });
    expect(out).toEqual({ id: 7, title: 'Pick venue' });
    expect(repo.listToolCalls(db, sessionId)).toEqual([
      expect.objectContaining({ toolName: 'createTask', output: { id: 7, title: 'Pick venue' }, success: true, error: null }),
    ]);
  });

  it('returns tool errors to the model as data and logs them as failures', async () => {
    const call = fakeMcp(async () => ({ ok: false, data: { error: 'Task 9 not found' }, error: 'Task 9 not found' }));
    const out = await run(build(call), 'updateTaskStatus', { taskId: 9, status: 'done' });

    expect(out).toEqual({ error: 'Task 9 not found' });
    expect(repo.listToolCalls(db, sessionId)).toEqual([
      expect.objectContaining({ toolName: 'updateTaskStatus', input: { taskId: 9, status: 'done' }, success: false, error: 'Task 9 not found' }),
    ]);
  });

  it('wraps input validation errors (plain-text data) as an error object too', async () => {
    const message = 'MCP error -32602: Input validation error: Too big: expected string to have <=200 characters at title';
    const call = fakeMcp(async () => ({ ok: false, data: message, error: message }));
    expect(await run(build(call), 'createTask', { title: 'x'.repeat(201) })).toEqual({ error: message });
  });

  it('turns a transport failure (server down, timeout, abort) into an error result and logs it', async () => {
    const call = fakeMcp(async () => {
      throw new Error('Request timed out');
    });
    const out = await run(build(call), 'listTasks', {});

    expect(out).toEqual({ error: 'MCP call failed: Request timed out' });
    expect(repo.listToolCalls(db, sessionId)).toEqual([
      expect.objectContaining({ toolName: 'listTasks', output: null, success: false, error: 'Request timed out' }),
    ]);
  });

  it('caps a large result for the model but logs it in full', async () => {
    const tasks = Array.from({ length: 500 }, (_, i) => ({ id: i, title: `Task number ${i}` }));
    const call = fakeMcp(async () => ({ ok: true, data: tasks, error: null }));
    const out = (await run(build(call), 'listTasks', {})) as { truncated: boolean; preview: string };

    expect(out.truncated).toBe(true);
    expect(out.preview).toHaveLength(MAX_TOOL_OUTPUT_CHARS);
    expect(repo.listToolCalls(db, sessionId)[0].output).toEqual(tasks);
  });
});
