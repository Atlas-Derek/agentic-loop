/**
 * Workflow MCP server (stdio transport).
 *
 * Launched as a child process by the Next.js backend (lib/mcp/client.ts),
 * or standalone for debugging:  npm run mcp:inspect
 *
 * stdout carries the MCP protocol, so all logging goes to stderr.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { defaultDbPath, openDb } from '../lib/db/index';
import * as repo from '../lib/db/repo';
import { TOOL_DEFS, withSessionId } from '../lib/mcp/schemas';

const db = openDb(defaultDbPath());
const server = new McpServer({ name: 'workflow-tools', version: '0.1.0' });

/** Run a handler and turn its result (or thrown error) into an MCP tool result. */
function respond(fn: () => unknown): CallToolResult {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(fn()) }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[mcp] tool error: ${message}`);
    return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
  }
}

server.registerTool(
  'createTask',
  { description: TOOL_DEFS.createTask.description, inputSchema: withSessionId(TOOL_DEFS.createTask.input) },
  async ({ sessionId, title, description }) => respond(() => repo.createTask(db, sessionId, { title, description })),
);

server.registerTool(
  'listTasks',
  { description: TOOL_DEFS.listTasks.description, inputSchema: withSessionId(TOOL_DEFS.listTasks.input) },
  async ({ sessionId }) => respond(() => repo.listTasks(db, sessionId)),
);

server.registerTool(
  'updateTaskStatus',
  { description: TOOL_DEFS.updateTaskStatus.description, inputSchema: withSessionId(TOOL_DEFS.updateTaskStatus.input) },
  async ({ sessionId, taskId, status, note }) => respond(() => repo.updateTaskStatus(db, sessionId, taskId, status, note)),
);

server.registerTool(
  'saveSummary',
  { description: TOOL_DEFS.saveSummary.description, inputSchema: withSessionId(TOOL_DEFS.saveSummary.input) },
  async ({ sessionId, summary }) =>
    respond(() => {
      const saved = repo.saveFinalSummary(db, sessionId, summary);
      return { saved: true, summaryId: saved.id, workflow: repo.getWorkflowState(db, sessionId).phase };
    }),
);

server.registerTool(
  'proposeMemory',
  { description: TOOL_DEFS.proposeMemory.description, inputSchema: withSessionId(TOOL_DEFS.proposeMemory.input) },
  async ({ sessionId, content, reason }) =>
    respond(() => {
      const m = repo.proposeMemory(db, { content, reason, sourceSessionId: sessionId });
      return { proposed: true, memoryId: m.id, note: 'Awaiting human approval; not yet active.' };
    }),
);

await server.connect(new StdioServerTransport());
console.error(`[mcp] workflow-tools ready (db: ${defaultDbPath()})`);
