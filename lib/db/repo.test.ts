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
    const s = repo.updateSession(db, sessionId, { provider: 'google', model: 'gemini-3.8-flash' });
    expect(s.provider).toBe('google');
    expect(s.model).toBe('gemini-3.8-flash');
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

  it('reports existing message ids and never updates a message from another session', () => {
    repo.upsertMessages(db, sessionId, [{ id: 'a', role: 'user', parts: [{ type: 'text', text: 'mine' }] }]);
    expect(repo.messageExists(db, 'a')).toBe(true);
    expect(repo.messageExists(db, 'zzz')).toBe(false);
    const other = repo.createSession(db, { provider: 'openai', model: 'gpt-5-mini' }).id;
    expect(() => repo.upsertMessages(db, other, [{ id: 'a', role: 'user', parts: [{ type: 'text', text: 'hijack' }] }])).toThrow();
    expect(repo.getMessages(db, sessionId)[0].parts).toEqual([{ type: 'text', text: 'mine' }]);
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

  it('enforces task status transitions', () => {
    const t = repo.createTask(db, sessionId, { title: 'Step' });
    repo.updateTaskStatus(db, sessionId, t.id, 'done'); // pending -> done (skipping in_progress) is allowed
    repo.updateTaskStatus(db, sessionId, t.id, 'done', 'note only'); // same status updates the note
    expect(() => repo.updateTaskStatus(db, sessionId, t.id, 'pending')).toThrow(/cannot go from done to pending. Allowed: in_progress/);
    expect(() => repo.updateTaskStatus(db, sessionId, t.id, 'blocked')).toThrow(/cannot go from done to blocked/);
    expect(repo.updateTaskStatus(db, sessionId, t.id, 'in_progress').status).toBe('in_progress'); // reopen
  });

  it('treats a completed workflow as read-only', () => {
    const t = repo.createTask(db, sessionId, { title: 'Only step' });
    repo.updateTaskStatus(db, sessionId, t.id, 'done');
    repo.saveFinalSummary(db, sessionId, 'done');

    expect(() => repo.createTask(db, sessionId, { title: 'New goal' })).toThrow(/already complete/);
    expect(() => repo.updateTaskStatus(db, sessionId, t.id, 'pending')).toThrow(/already complete/);
    expect(() => repo.saveFinalSummary(db, sessionId, 'again')).toThrow(/already complete/);
    expect(repo.getWorkflowState(db, sessionId)).toMatchObject({ phase: 'complete', counts: { done: 1, pending: 0 } });
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
