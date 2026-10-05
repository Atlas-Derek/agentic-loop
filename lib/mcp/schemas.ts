/**
 * Single source of truth for the workflow tools.
 *
 * `input` is what the MODEL sees. The MCP server additionally requires a
 * `sessionId`, which the backend wrapper injects (see lib/agent/tools.ts),
 * so the model never has to know or guess session IDs.
 */
import { z } from 'zod';
import { TASK_STATUSES } from '../db/repo';

export const TOOL_DEFS = {
  createTask: {
    description: 'Create one workflow step (task) for the current session. Call once per step, in order.',
    input: {
      title: z.string().min(1).describe('Short imperative title, e.g. "Draft agenda"'),
      description: z.string().optional().describe('What this step involves'),
    },
  },
  listTasks: {
    description: 'List all tasks for the current session with their ids and statuses.',
    input: {},
  },
  updateTaskStatus: {
    description: 'Change the status of a task. Use in_progress when starting a step, done when finished, blocked if it cannot proceed.',
    input: {
      taskId: z.number().int().describe('Task id returned by createTask or listTasks'),
      status: z.enum(TASK_STATUSES),
      note: z.string().optional().describe('Optional short note about the outcome'),
    },
  },
  saveSummary: {
    description: 'Save the final summary and mark the workflow complete. Fails if any task is still pending or in_progress.',
    input: {
      summary: z.string().min(1).describe('Final summary: goal, what was done per step, outcomes, follow-ups'),
    },
  },
  proposeMemory: {
    description:
      'Propose a durable fact or preference about the user to remember across sessions. A human must approve it before it is used. Only for things the user clearly stated.',
    input: {
      content: z.string().min(1).describe('The fact, e.g. "User prefers TypeScript examples."'),
      reason: z.string().describe('Why this is worth remembering'),
    },
  },
} as const;

export type ToolName = keyof typeof TOOL_DEFS;
export const TOOL_NAMES = Object.keys(TOOL_DEFS) as ToolName[];

/** Schema the MCP server registers: model input + injected sessionId. */
export function withSessionId<S extends z.ZodRawShape>(shape: S) {
  return z.object({ sessionId: z.string().describe('Injected by the host app'), ...shape });
}
