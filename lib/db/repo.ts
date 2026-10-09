/**
 * Typed data-access functions. Every function takes the DB handle as its first
 * argument so tests can pass an in-memory database.
 */
import { randomUUID } from 'node:crypto';
import type { UIMessage } from 'ai';
import type { DB } from './index';

export class AgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentError';
  }
}

const now = (): string => new Date().toISOString();

// ---------------------------------------------------------------- types

export type Provider = 'openai' | 'google';
export const TASK_STATUSES = ['pending', 'in_progress', 'done', 'blocked'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type MemoryStatus = 'proposed' | 'approved' | 'rejected';
export type WorkflowPhase = 'clarifying' | 'executing' | 'complete';

export type Session = {
  id: string;
  title: string;
  provider: Provider;
  model: string;
  createdAt: string;
  updatedAt: string;
};

export type StoredMessage = {
  id: string;
  seq: number;
  role: UIMessage['role'];
  parts: UIMessage['parts'];
  compacted: boolean;
  createdAt: string;
};

export type Task = {
  id: number;
  position: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  note: string | null;
  updatedAt: string;
};

export type ToolCallLog = {
  id: number;
  toolName: string;
  input: unknown;
  output: unknown;
  success: boolean;
  error: string | null;
  durationMs: number;
  createdAt: string;
};

export type Summary = {
  id: number;
  kind: 'compaction' | 'final';
  content: string;
  coversThroughSeq: number | null;
  createdAt: string;
};

export type Memory = {
  id: number;
  content: string;
  reason: string | null;
  status: MemoryStatus;
  sourceSessionId: string | null;
  createdAt: string;
};

export type WorkflowState = {
  phase: WorkflowPhase;
  tasks: Task[];
  counts: Record<TaskStatus, number>;
};

// Raw row shapes as SQLite returns them.
type SessionRow = { id: string; title: string; provider: Provider; model: string; created_at: string; updated_at: string };
type MessageRow = { id: string; seq: number; role: UIMessage['role']; parts_json: string; compacted: number; created_at: string };
type TaskRow = { id: number; position: number; title: string; description: string | null; status: TaskStatus; note: string | null; updated_at: string };
type ToolCallRow = { id: number; tool_name: string; input_json: string; output_json: string | null; success: number; error: string | null; duration_ms: number; created_at: string };
type SummaryRow = { id: number; kind: 'compaction' | 'final'; content: string; covers_through_seq: number | null; created_at: string };
type MemoryRow = { id: number; content: string; reason: string | null; status: MemoryStatus; source_session_id: string | null; created_at: string };

const toSession = (r: SessionRow): Session => ({
  id: r.id, title: r.title, provider: r.provider, model: r.model, createdAt: r.created_at, updatedAt: r.updated_at,
});
const toTask = (r: TaskRow): Task => ({
  id: r.id, position: r.position, title: r.title, description: r.description, status: r.status, note: r.note, updatedAt: r.updated_at,
});
const toMemory = (r: MemoryRow): Memory => ({
  id: r.id, content: r.content, reason: r.reason, status: r.status, sourceSessionId: r.source_session_id, createdAt: r.created_at,
});
const parseJson = (s: string | null): unknown => (s === null ? null : JSON.parse(s));

// ---------------------------------------------------------------- sessions

export function createSession(db: DB, input: { provider: Provider; model: string; title?: string }): Session {
  const ts = now();
  const row: SessionRow = {
    id: randomUUID(),
    title: input.title ?? 'New session',
    provider: input.provider,
    model: input.model,
    created_at: ts,
    updated_at: ts,
  };
  db.prepare(
    'INSERT INTO sessions (id, title, provider, model, created_at, updated_at) VALUES (@id, @title, @provider, @model, @created_at, @updated_at)',
  ).run(row);
  return toSession(row);
}

export function getSession(db: DB, id: string): Session | null {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  return row ? toSession(row) : null;
}

export function requireSession(db: DB, id: string): Session {
  const s = getSession(db, id);
  if (!s) throw new AgentError(`Session ${id} not found`);
  return s;
}

export function listSessions(db: DB): Session[] {
  return (db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as SessionRow[]).map(toSession);
}

export function updateSession(db: DB, id: string, patch: { provider?: Provider; model?: string; title?: string }): Session {
  const s = requireSession(db, id);
  db.prepare('UPDATE sessions SET provider = ?, model = ?, title = ?, updated_at = ? WHERE id = ?').run(
    patch.provider ?? s.provider, patch.model ?? s.model, patch.title ?? s.title, now(), id,
  );
  return requireSession(db, id);
}

/**
 * Permanently delete a session. Messages, tasks, tool calls and summaries go with it via ON DELETE CASCADE
 * (openDb enables foreign keys). Memories are global, so they are kept; only their source link is cleared.
 */
export function deleteSession(db: DB, id: string): void {
  requireSession(db, id);
  db.transaction(() => {
    db.prepare('UPDATE memories SET source_session_id = NULL WHERE source_session_id = ?').run(id);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  })();
}

// ---------------------------------------------------------------- messages

/** Insert new messages or update existing ones (matched by id). New ones get the next seq. */
export function upsertMessages(db: DB, sessionId: string, messages: Pick<UIMessage, 'id' | 'role' | 'parts'>[]): void {
  const exists = db.prepare('SELECT 1 FROM messages WHERE id = ? AND session_id = ?');
  const update = db.prepare('UPDATE messages SET parts_json = ? WHERE id = ? AND session_id = ?');
  const nextSeq = db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM messages WHERE session_id = ?');
  const insert = db.prepare(
    'INSERT INTO messages (id, session_id, seq, role, parts_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  db.transaction(() => {
    for (const m of messages) {
      const parts = JSON.stringify(m.parts);
      if (exists.get(m.id, sessionId)) {
        update.run(parts, m.id, sessionId);
      } else {
        const { seq } = nextSeq.get(sessionId) as { seq: number };
        insert.run(m.id, sessionId, seq, m.role, parts, now());
      }
    }
    db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now(), sessionId);
  })();
}

/** True if a message with this id exists in any session (message ids are globally unique). */
export function messageExists(db: DB, id: string): boolean {
  return db.prepare('SELECT 1 FROM messages WHERE id = ?').get(id) !== undefined;
}

export function getMessages(db: DB, sessionId: string, opts: { includeCompacted?: boolean } = {}): StoredMessage[] {
  const sql = opts.includeCompacted
    ? 'SELECT * FROM messages WHERE session_id = ? ORDER BY seq'
    : 'SELECT * FROM messages WHERE session_id = ? AND compacted = 0 ORDER BY seq';
  return (db.prepare(sql).all(sessionId) as MessageRow[]).map((r) => ({
    id: r.id,
    seq: r.seq,
    role: r.role,
    parts: JSON.parse(r.parts_json) as UIMessage['parts'],
    compacted: r.compacted === 1,
    createdAt: r.created_at,
  }));
}

/** Flag messages up to and including `throughSeq` as compacted. Rows are kept for debugging. */
export function markCompacted(db: DB, sessionId: string, throughSeq: number): void {
  db.prepare('UPDATE messages SET compacted = 1 WHERE session_id = ? AND seq <= ?').run(sessionId, throughSeq);
}

// ---------------------------------------------------------------- tasks

/** A completed workflow is final: tasks and the summary become read-only. A new goal needs a new session. */
function assertNotComplete(db: DB, sessionId: string): void {
  if (getLatestSummary(db, sessionId, 'final')) {
    throw new AgentError('This workflow is already complete and read-only. Ask the user to start a new session for a new goal.');
  }
}

export function createTask(db: DB, sessionId: string, input: { title: string; description?: string }): Task {
  requireSession(db, sessionId);
  assertNotComplete(db, sessionId);
  const { pos } = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS pos FROM tasks WHERE session_id = ?').get(sessionId) as { pos: number };
  const info = db
    .prepare('INSERT INTO tasks (session_id, position, title, description, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(sessionId, pos, input.title, input.description ?? null, now());
  return getTask(db, sessionId, Number(info.lastInsertRowid));
}

export function getTask(db: DB, sessionId: string, taskId: number): Task {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ? AND session_id = ?').get(taskId, sessionId) as TaskRow | undefined;
  if (!row) throw new AgentError(`Task ${taskId} not found in this session`);
  return toTask(row);
}

export function listTasks(db: DB, sessionId: string): Task[] {
  return (db.prepare('SELECT * FROM tasks WHERE session_id = ? ORDER BY position').all(sessionId) as TaskRow[]).map(toTask);
}

/**
 * Allowed status changes. Setting the same status again is always allowed (e.g. to update the note).
 * Skipping in_progress is allowed so the model can batch quick steps. A done step can only be
 * reopened as in_progress, so finished work never silently drops back to pending/blocked.
 */
const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ['in_progress', 'done', 'blocked'],
  in_progress: ['pending', 'done', 'blocked'],
  blocked: ['pending', 'in_progress', 'done'],
  done: ['in_progress'],
};

export function updateTaskStatus(db: DB, sessionId: string, taskId: number, status: TaskStatus, note?: string): Task {
  const task = getTask(db, sessionId, taskId); // throws if missing
  assertNotComplete(db, sessionId);
  if (task.status !== status && !TASK_TRANSITIONS[task.status].includes(status)) {
    throw new AgentError(
      `Task ${taskId} cannot go from ${task.status} to ${status}. Allowed: ${TASK_TRANSITIONS[task.status].join(', ')}.`,
    );
  }
  db.prepare('UPDATE tasks SET status = ?, note = COALESCE(?, note), updated_at = ? WHERE id = ?').run(status, note ?? null, now(), taskId);
  return getTask(db, sessionId, taskId);
}

// ---------------------------------------------------------------- workflow state

/** Derived from tasks + summaries so it can never drift out of sync. */
export function getWorkflowState(db: DB, sessionId: string): WorkflowState {
  const tasks = listTasks(db, sessionId);
  const counts: Record<TaskStatus, number> = { pending: 0, in_progress: 0, done: 0, blocked: 0 };
  for (const t of tasks) counts[t.status] += 1;
  const phase: WorkflowPhase = getLatestSummary(db, sessionId, 'final')
    ? 'complete'
    : tasks.length === 0
      ? 'clarifying'
      : 'executing';
  return { phase, tasks, counts };
}

// ---------------------------------------------------------------- summaries

export function addSummary(db: DB, sessionId: string, kind: Summary['kind'], content: string, coversThroughSeq?: number): Summary {
  const info = db
    .prepare('INSERT INTO summaries (session_id, kind, content, covers_through_seq, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(sessionId, kind, content, coversThroughSeq ?? null, now());
  return getSummaryById(db, Number(info.lastInsertRowid));
}

function getSummaryById(db: DB, id: number): Summary {
  const r = db.prepare('SELECT * FROM summaries WHERE id = ?').get(id) as SummaryRow;
  return { id: r.id, kind: r.kind, content: r.content, coversThroughSeq: r.covers_through_seq, createdAt: r.created_at };
}

export function getLatestSummary(db: DB, sessionId: string, kind: Summary['kind']): Summary | null {
  const r = db
    .prepare('SELECT * FROM summaries WHERE session_id = ? AND kind = ? ORDER BY id DESC LIMIT 1')
    .get(sessionId, kind) as SummaryRow | undefined;
  return r ? { id: r.id, kind: r.kind, content: r.content, coversThroughSeq: r.covers_through_seq, createdAt: r.created_at } : null;
}

/** The saveSummary tool: only allowed once every task is done or blocked, and only once per session. */
export function saveFinalSummary(db: DB, sessionId: string, content: string): Summary {
  assertNotComplete(db, sessionId);
  const { tasks } = getWorkflowState(db, sessionId);
  if (tasks.length === 0) throw new AgentError('Cannot complete a workflow with no tasks');
  const open = tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress');
  if (open.length > 0) {
    throw new AgentError(`Cannot save final summary: ${open.length} task(s) still open (${open.map((t) => `#${t.id}`).join(', ')})`);
  }
  return addSummary(db, sessionId, 'final', content);
}

// ---------------------------------------------------------------- tool call log

export function logToolCall(
  db: DB,
  sessionId: string,
  entry: { toolName: string; input: unknown; output: unknown; success: boolean; error?: string; durationMs: number },
): void {
  db.prepare(
    'INSERT INTO tool_calls (session_id, tool_name, input_json, output_json, success, error, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    sessionId, entry.toolName, JSON.stringify(entry.input ?? null), JSON.stringify(entry.output ?? null),
    entry.success ? 1 : 0, entry.error ?? null, entry.durationMs, now(),
  );
}

export function listToolCalls(db: DB, sessionId: string): ToolCallLog[] {
  return (db.prepare('SELECT * FROM tool_calls WHERE session_id = ? ORDER BY id').all(sessionId) as ToolCallRow[]).map((r) => ({
    id: r.id,
    toolName: r.tool_name,
    input: parseJson(r.input_json),
    output: parseJson(r.output_json),
    success: r.success === 1,
    error: r.error,
    durationMs: r.duration_ms,
    createdAt: r.created_at,
  }));
}

// ---------------------------------------------------------------- memories

export function proposeMemory(db: DB, input: { content: string; reason?: string; sourceSessionId?: string }): Memory {
  const info = db
    .prepare('INSERT INTO memories (content, reason, status, source_session_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(input.content, input.reason ?? null, 'proposed', input.sourceSessionId ?? null, now());
  return toMemory(db.prepare('SELECT * FROM memories WHERE id = ?').get(Number(info.lastInsertRowid)) as MemoryRow);
}

export function listMemories(db: DB, status?: MemoryStatus): Memory[] {
  const rows = status
    ? db.prepare('SELECT * FROM memories WHERE status = ? ORDER BY id').all(status)
    : db.prepare('SELECT * FROM memories ORDER BY id').all();
  return (rows as MemoryRow[]).map(toMemory);
}

export function setMemoryStatus(db: DB, id: number, status: MemoryStatus): Memory {
  const info = db.prepare('UPDATE memories SET status = ? WHERE id = ?').run(status, id);
  if (info.changes === 0) throw new AgentError(`Memory ${id} not found`);
  return toMemory(db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRow);
}
