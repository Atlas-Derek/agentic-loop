/**
 * AI SDK tool wrappers around the MCP tools.
 *
 * Each wrapper:
 *  1. exposes the model-facing schema from lib/mcp/schemas.ts (no sessionId),
 *  2. injects the current sessionId and forwards the call to the MCP server,
 *  3. records name / input / output / success / duration in the tool_calls table.
 */
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { getDb } from '../db/index';
import { logToolCall } from '../db/repo';
import { callMcpTool } from '../mcp/client';
import { TOOL_DEFS, TOOL_NAMES } from '../mcp/schemas';

export function buildWorkflowTools(sessionId: string): ToolSet {
  const tools: ToolSet = {};
  for (const name of TOOL_NAMES) {
    const def = TOOL_DEFS[name];
    tools[name] = tool({
      description: def.description,
      inputSchema: z.object(def.input),
      execute: async (input: Record<string, unknown>) => {
        const started = Date.now();
        try {
          const res = await callMcpTool(name, { ...input, sessionId });
          logToolCall(getDb(), sessionId, {
            toolName: name, input, output: res.data, success: res.ok, error: res.error ?? undefined, durationMs: Date.now() - started,
          });
          // Return failures to the model as data so it can recover (e.g. retry with a valid task id).
          return res.ok ? res.data : { error: res.error };
        } catch (err) {
          // Transport-level failure (MCP server down, etc.)
          const message = err instanceof Error ? err.message : String(err);
          logToolCall(getDb(), sessionId, { toolName: name, input, output: null, success: false, error: message, durationMs: Date.now() - started });
          return { error: `MCP call failed: ${message}` };
        }
      },
    });
  }
  return tools;
}
