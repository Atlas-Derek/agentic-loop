# agentic-loop

A small agentic app that takes a user goal, reasons through the steps, calls tools over MCP, keeps session state, and completes a simple workflow.

Stack: Next.js 16 · Vercel AI SDK 7 · Model Context Protocol (stdio) · SQLite (better-sqlite3).
Models: OpenAI (GPT-5 mini, GPT-5) and Google (Gemini 3.8 Flash, Gemini Pro latest), switchable per message.

## Run it

```bash
nvm use                      # Node 24 (see .nvmrc)
npm install
cp .env.example .env.local   # add OPENAI_API_KEY and/or GOOGLE_GENERATIVE_AI_API_KEY
npm run dev                  # http://localhost:3000
```

The SQLite file is created at `data/agent.db`. Delete it to start fresh, or remove single sessions with the **×** next to each one in the sidebar (this also deletes its messages, tasks, tool log and summaries; approved memories are global and stay). Rename a session with the pencil icon or by double-clicking its name; otherwise it's named after your first message.

## Try it

1. Click **New session** and type a goal, e.g. *"Help me plan a 1-day team offsite."*
2. The agent asks a few clarifying questions. Answer them.
3. It creates tasks (watch **Workflow** and **Tool calls** on the right), then works through them, marking each `in_progress` → `done`.
4. Say something durable like *"I prefer TypeScript examples."* The agent proposes a memory; approve it in **Memory**.
5. Switch the model in the left column mid-session; the next turn uses the new model.
6. Reload the page or pick the session from the list: messages, tasks and tool logs come back.
7. After ~12 messages, older ones are compacted (dimmed in chat, summary shown under **Compaction**). Originals stay in the DB.
8. When all tasks are done the agent calls `saveSummary`; the phase flips to **complete** and the final summary appears. A completed session is read-only; start a new session for a new goal.

Set `COMPACT_AFTER=6` in `.env.local` to see compaction sooner. Compaction uses the provider's cheap model (GPT-5 mini / Gemini Flash) and runs in the background, so it appears in the panel shortly after the turn ends.

**Access.** `npm run dev` / `npm start` listen on 127.0.0.1 only, and the request guard (`proxy.ts`) accepts only loopback `Host` headers, which also blocks DNS rebinding. API writes must be same-origin JSON. To serve the app on your network, start it with `-H 0.0.0.0`, list the hostnames or IPs people will use in `ALLOWED_HOSTS`, and set `APP_PASSWORD` (required for any non-loopback host); the browser will prompt for it (any username).

## How it works

| Concern | Where |
|---|---|
| Agent loop (`streamText` + `stopWhen`) | `app/api/chat/route.ts` |
| System instructions from state | `lib/agent/prompt.ts` |
| MCP tool server (`createTask`, `listTasks`, `updateTaskStatus`, `saveSummary`, `proposeMemory`) | `mcp-server/index.ts` |
| MCP client + AI SDK tool wrappers (inject sessionId, log every call) | `lib/mcp/client.ts`, `lib/agent/tools.ts` |
| Persistence: sessions, messages, tasks, tool calls, summaries, memories | `lib/db/` |
| Compaction | `lib/agent/compaction.ts` |
| UI | `app/page.tsx`, `components/` |

**Tool call inspection.** Every call is stored in the `tool_calls` table with the tool name, input, result, success flag, error and duration, and shown in the UI's Tool calls panel.

**Memory.** The agent can only *propose* memories. They're used in prompts after a human approves them in the UI, and apply to all sessions.

**Debugging.**

- `GET /api/sessions/<id>?debug=1` returns the full state, including which messages the model still sees verbatim.
- `npm run mcp:inspect` opens the MCP Inspector against the tool server.
- `sqlite3 data/agent.db` lets you query the tables directly.

## Tests

```bash
npm test         # repo, compaction, prompt, real MCP server over stdio, mocked-model end-to-end agent loop, jsdom UI test
npm run typecheck
```
