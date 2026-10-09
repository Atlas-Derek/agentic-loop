/**
 * MCP client: spawns mcp-server/index.ts as a child process and talks to it over stdio.
 * Kept as a lazy singleton on globalThis so Next dev hot reloads don't spawn duplicates.
 */
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

export type McpToolResult = { ok: boolean; data: unknown; error: string | null };

/** Per-call timeout. Tools here are local SQLite writes, so anything slow means something is wrong. */
const TOOL_TIMEOUT_MS = 15_000;

/**
 * The tool server only needs a minimal, safe environment plus its DB path.
 * In particular it must NOT inherit provider API keys.
 */
function serverEnv(): Record<string, string> {
  const env = getDefaultEnvironment();
  for (const key of ['AGENT_DB_PATH', 'NODE_ENV'] as const) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

const globalForMcp = globalThis as unknown as { __mcpClient?: Promise<Client> };

async function connect(): Promise<Client> {
  const transport = new StdioClientTransport({
    // Run the TypeScript server with the current Node binary + the tsx loader.
    command: process.execPath,
    args: ['--import', 'tsx', path.resolve(/*turbopackIgnore: true*/ process.cwd(), 'mcp-server/index.ts')],
    cwd: process.cwd(),
    env: serverEnv(),
    stderr: 'inherit', // server logs show up in the dev terminal
  });
  const client = new Client({ name: 'agentic-loop', version: '0.1.0' });
  // If the server process dies, drop the cached client so the next call respawns it.
  transport.onclose = () => {
    globalForMcp.__mcpClient = undefined;
  };
  await client.connect(transport);
  return client;
}

export function getMcpClient(): Promise<Client> {
  globalForMcp.__mcpClient ??= connect().catch((err: unknown) => {
    globalForMcp.__mcpClient = undefined;
    throw err;
  });
  return globalForMcp.__mcpClient;
}

/** Call an MCP tool and normalise the result. Tool-level failures come back as ok=false, not throws. */
export async function callMcpTool(
  name: string,
  args: Record<string, unknown>,
  opts: { signal?: AbortSignal } = {},
): Promise<McpToolResult> {
  const client = await getMcpClient();
  const result = await client.callTool({ name, arguments: args }, undefined, { signal: opts.signal, timeout: TOOL_TIMEOUT_MS });
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .map((c: unknown) => (typeof c === 'object' && c !== null && 'text' in c ? String((c as { text: unknown }).text) : ''))
    .join('');
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // non-JSON text: keep as string
  }
  if (result.isError) {
    const error = typeof data === 'object' && data !== null && 'error' in data ? String((data as { error: unknown }).error) : text;
    return { ok: false, data, error };
  }
  return { ok: true, data, error: null };
}
