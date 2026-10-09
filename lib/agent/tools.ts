/**
 * AI SDK tool wrappers around the MCP tools.
 *
 * Each wrapper:
 *  1. exposes the model-facing schema from lib/mcp/schemas.ts (no sessionId),
 *  2. injects the current sessionId and forwards the call to the MCP server,
 *  3. records name / input / output / success / duration in the tool_calls table (full output),
 *  4. caps what goes back to the model so one large result can't flood the context window.
 */
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { getDb, type DB } from '../db/index';
import { logToolCall } from '../db/repo';
import { callMcpTool } from '../mcp/client';
import { TOOL_DEFS, TOOL_NAMES } from '../mcp/schemas';

/** Max serialized size of a tool result sent to the model. The tool_calls log keeps the full value. */
export const MAX_TOOL_OUTPUT_CHARS = 8_000;

/** Pass small results through unchanged; replace large ones with a clearly marked, truncated preview. */
export function capToolOutput(output: unknown, max = MAX_TOOL_OUTPUT_CHARS): unknown {
  const json = JSON.stringify(output) ?? 'null';
  if (json.length <= max) return output;
  return {
    truncated: true,
    note: `Result was ${json.length} characters; only the first ${max} are shown. Narrow the request if you need the rest.`,
    preview: json.slice(0, max),
  };
}

/** Collaborators of the tool wrappers; tests pass an in-memory DB and a fake MCP call. */
export type WorkflowToolDeps = { getDb: () => DB; callMcpTool: typeof callMcpTool };

export function buildWorkflowTools(sessionId: string, deps: WorkflowToolDeps = { getDb, callMcpTool }): ToolSet {
  const tools: ToolSet = {};
  for (const name of TOOL_NAMES) {
    const def = TOOL_DEFS[name];
    tools[name] = tool({
      description: def.description,
      inputSchema: z.object(def.input),
      execute: async (input: Record<string, unknown>, { abortSignal }) => {
        const started = Date.now();
        try {
          const res = await deps.callMcpTool(name, { ...input, sessionId }, { signal: abortSignal });
          logToolCall(deps.getDb(), sessionId, {
            toolName: name, input, output: res.data, success: res.ok, error: res.error ?? undefined, durationMs: Date.now() - started,
          });
          // Return failures to the model as data so it can recover (e.g. retry with a valid task id).
          return capToolOutput(res.ok ? res.data : { error: res.error });
        } catch (err) {
          // Transport-level failure (MCP server down, timeout, request aborted by the user, etc.)
          const message = err instanceof Error ? err.message : String(err);
          logToolCall(deps.getDb(), sessionId, { toolName: name, input, output: null, success: false, error: message, durationMs: Date.now() - started });
          return { error: `MCP call failed: ${message}` };
        }
      },
    });
  }
  return tools;
}
