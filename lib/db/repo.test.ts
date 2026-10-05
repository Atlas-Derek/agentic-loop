import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from './index';
import * as repo from './repo';

let db: DB;
let sessionId: string;

beforeEach(() => {
  db = openDb(':memory:');
  sessionId = repo.createSession(db, { provider: 'openai', model: 'gpt-5-mini' }).id;
});

describe('sessions', () => {
  it('creates, lists and switches model', () => {
    expect(repo.listSessions(db)).toHaveLength(1);
    const s = repo.updateSession(db, sessionId, { provider: 'google', model: 'gemini-2.5-flash' });
    expect(s.provider).toBe('google');
    expect(s.model).toBe('gemini-2.5-flash');
  });

  it('throws for a missing session', () => {
    expect(() => repo.requireSession(db, 'nope')).toThrow(repo.AgentError);
  });
});

describe('messages', () => {
  it('appends with increasing seq and updates by id', () => {
    repo.upsertMessages(db, sessionId, [
      { id: 'a', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'b', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] },
    ]);
    repo.upsertMessages(db, sessionId, [{ id: 'b', role: 'assistant', parts: [{ type: 'text', text: 'edited' }] }]);
    const msgs = repo.getMessages(db, sessionId);
    expect(msgs.map((m) => m.seq)).toEqual([1, 2]);
    expect(msgs[1].parts).toEqual([{ type: 'text', text: 'edited' }]);
  });

  it('hides compacted messages but keeps them stored', () => {
    repo.upsertMessages(db, sessionId, ['a', 'b', 'c'].map((id) => ({ id, role: 'user' as const, parts: [] })));
    repo.markCompacted(db, sessionId, 2);
    expect(repo.getMessages(db, sessionId).map((m) => m.id)).toEqual(['c']);
    expect(repo.getMessages(db, sessionId, { includeCompacted: true })).toHaveLength(3);
  });
});

describe('tasks and workflow state', () => {
  it('moves from clarifying to executing to complete', () => {
    expect(repo.getWorkflowState(db, sessionId).phase).toBe('clarifying');
    const t1 = repo.createTask(db, sessionId, { title: 'One' });
    const t2 = repo.createTask(db, sessionId, { title: 'Two' });
    expect(t2.position).toBe(2);
    expect(repo.getWorkflowState(db, sessionId).phase).toBe('executing');

    repo.updateTaskStatus(db, sessionId, t1.id, 'done', 'finished');
    expect(() => repo.saveFinalSummary(db, sessionId, 'all done')).toThrow(/still open/);

    repo.updateTaskStatus(db, sessionId, t2.id, 'blocked');
    repo.saveFinalSummary(db, sessionId, 'all done');
    const state = repo.getWorkflowState(db, sessionId);
    expect(state.phase).toBe('complete');
    expect(state.counts).toEqual({ pending: 0, in_progress: 0, done: 1, blocked: 1 });
  });

  it('refuses to update a task from another session', () => {
    const other = repo.createSession(db, { provider: 'openai', model: 'gpt-5-mini' }).id;
    const t = repo.createTask(db, other, { title: 'Theirs' });
    expect(() => repo.updateTaskStatus(db, sessionId, t.id, 'done')).toThrow(/not found/);
  });

  it('refuses a final summary with no tasks', () => {
    expect(() => repo.saveFinalSummary(db, sessionId, 'x')).toThrow(/no tasks/);
  });
});

describe('tool call log', () => {
  it('round-trips JSON input and output', () => {
    repo.logToolCall(db, sessionId, { toolName: 'createTask', input: { title: 'x' }, output: { id: 1 }, success: true, durationMs: 5 });
    repo.logToolCall(db, sessionId, { toolName: 'updateTaskStatus', input: { taskId: 9 }, output: null, success: false, error: 'nope', durationMs: 2 });
    const log = repo.listToolCalls(db, sessionId);
    expect(log[0]).toMatchObject({ toolName: 'createTask', input: { title: 'x' }, output: { id: 1 }, success: true });
    expect(log[1]).toMatchObject({ success: false, error: 'nope' });
  });
});

describe('memories', () => {
  it('only lists approved memories when filtered', () => {
    const m = repo.proposeMemory(db, { content: 'Prefers TypeScript', reason: 'user said so', sourceSessionId: sessionId });
    expect(repo.listMemories(db, 'approved')).toHaveLength(0);
    repo.setMemoryStatus(db, m.id, 'approved');
    expect(repo.listMemories(db, 'approved').map((x) => x.content)).toEqual(['Prefers TypeScript']);
    expect(() => repo.setMemoryStatus(db, 999, 'approved')).toThrow(repo.AgentError);
  });
});
