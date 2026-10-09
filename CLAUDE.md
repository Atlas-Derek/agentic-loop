# CLAUDE.md — agentic-loop

Guidance for AI tools (and humans) working in this repo.

## What this is

A spike-quality **workflow planning agent**: Next.js (App Router) + Vercel AI SDK v7 + an MCP tool server + SQLite.
The agent clarifies a goal, breaks it into tasks, updates task status through MCP tools, compacts long sessions,
proposes memories for human approval, and saves a final summary when the workflow is complete.

```
Browser (app/page.tsx, useChat)
  └─POST /api/chat ─► app/api/chat/route.ts
                        builds instructions (lib/agent/prompt.ts) from SQLite state
                        streamText(model, tools, stopWhen: stepCountIs(12))
                          tools = lib/agent/tools.ts  ── injects sessionId, logs every call
                                     └─► lib/mcp/client.ts ── stdio ──► mcp-server/index.ts ─► SQLite
                        onEnd: persist messages, maybe compact (lib/agent/compaction.ts)
```

- `lib/db/` — schema + typed repo functions (DB handle passed in; tests use `:memory:`). Shared by both processes.
- `lib/mcp/schemas.ts` — single source of truth for tool names, descriptions and zod inputs.
- `lib/models.ts` — client-safe model registry. `lib/agent/model.ts` — server-side provider construction.
- Workflow phase is **derived** (`getWorkflowState`): no tasks → `clarifying`, tasks → `executing`, final summary → `complete`.
  `complete` is terminal: task/summary tools refuse to write, and a new goal needs a new session.
- Trust boundary: `/api/chat` accepts only one plain-text user message (zod-validated); history comes from SQLite.
  The compaction summary is passed as a tagged context message, never in the system instructions.
- `proxy.ts` guards every request: state-changing `/api/*` calls must be same-origin JSON; optional `APP_PASSWORD` adds HTTP Basic auth.
- Compaction runs in the background after a turn using the provider's `summarizer` model (`lib/models.ts`);
  the next turn awaits it (`waitForCompaction`).
- Schema changes to existing tables need a step in `migrate()` (`lib/db/index.ts`); `CREATE TABLE IF NOT EXISTS`
  won't add columns to databases that already exist. A running dev server keeps its DB handle, so restart it after a migration.
- Task status changes follow `TASK_TRANSITIONS` in `lib/db/repo.ts` (a `done` task can only be reopened as `in_progress`).

## Commands

Requires **Node 24** (`nvm use`); `better-sqlite3`'s prebuilt binary segfaults on Node 22.12.

- `npm run dev` — app at http://localhost:3000 (spawns the MCP server automatically)
- `npm test` — vitest (repo, compaction, prompt, MCP integration, mocked end-to-end agent loop, jsdom page test)
- `npm run typecheck`
- `npm run mcp:inspect` — open the MCP Inspector against the tool server
- `npm run build`

Env (`.env.local`): `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, optional `AGENT_DB_PATH`, `COMPACT_AFTER`, `KEEP_RECENT`, `APP_PASSWORD`.

## Conventions

- Strict TypeScript. `any` is forbidden; use `unknown` and narrow.
- `async/await`, no `.then()` chains.
- No silent failures: tool errors are returned to the model **and** logged to `tool_calls` with `success = 0`.
  Domain errors throw `AgentError` (lib/db/repo.ts).
- Server-only code (SQLite, MCP, provider SDKs) stays in `lib/db`, `lib/mcp`, `lib/agent`, `mcp-server`, and API routes.
  Client components may only import types and the client-safe modules `lib/models.ts`, `lib/theme.ts`,
  `lib/layout.ts` and `lib/limits.ts` (no server imports in those).
- The MCP server writes protocol on stdout: log to **stderr** only.
- The MCP server runs directly on Node 24 (type stripping, no tsx). Everything it imports (`mcp-server/`, `lib/db/`,
  `lib/mcp/schemas.ts`) must use relative value imports **with explicit `.ts` extensions** and only erasable TS syntax
  (no enums, namespaces or parameter properties). The spawned server gets a minimal env (no API keys).
- To add a tool: add it to `lib/mcp/schemas.ts`, implement it in `lib/db/repo.ts`, register it in `mcp-server/index.ts`.
  The AI SDK wrapper picks it up automatically.
- Tests live next to the code as `*.test.ts`. Prefer dependency injection (pass a DB) over mocking globals.

## Git

- Never push code changes.
- Never commit without a message describing what was done.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
