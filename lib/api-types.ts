/** Shapes returned by the API routes, shared with the client (type-only imports). */
import type { Memory, Provider, Session, StoredMessage, Summary, ToolCallLog, WorkflowState } from './db/repo';

export type { Memory, Provider, Session, StoredMessage, Summary, ToolCallLog, WorkflowState };

export type SessionsResponse = { sessions: Session[]; providers: Record<Provider, boolean> };

export type SessionState = {
  session: Session;
  messages: StoredMessage[];
  workflow: WorkflowState;
  toolCalls: ToolCallLog[];
  compaction: Summary | null;
  finalSummary: Summary | null;
};
