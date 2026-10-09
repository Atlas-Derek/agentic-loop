/**
 * The agent loop.
 *
 * Per request: persist the new user message, rebuild context from SQLite
 * (instructions + compaction summary + uncompacted history), stream the model
 * with the MCP-backed tools for up to MAX_STEPS tool/LLM round trips, then
 * persist the assistant message and compact if the session is getting long.
 */
import { convertToModelMessages, createIdGenerator, stepCountIs, streamText, type UIMessage } from 'ai';
import { getDb } from '@/lib/db';
import * as repo from '@/lib/db/repo';
import { getModel } from '@/lib/agent/model';
import { buildInstructions } from '@/lib/agent/prompt';
import { buildWorkflowTools } from '@/lib/agent/tools';
import { maybeCompact } from '@/lib/agent/compaction';

export const runtime = 'nodejs';
export const maxDuration = 120;

const MAX_STEPS = 12;

type ChatBody = {
  sessionId: string;
  message: UIMessage;
  provider: repo.Provider;
  model: string;
};

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json()) as ChatBody;
  const db = getDb();

  let model;
  try {
    repo.requireSession(db, body.sessionId);
    model = getModel(body.provider, body.model);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }

  // Remember the model choice (switching mid-session is allowed) and title new sessions.
  const session = repo.requireSession(db, body.sessionId);
  const firstText = body.message.parts.find((p) => p.type === 'text');
  repo.updateSession(db, session.id, {
    provider: body.provider,
    model: body.model,
    title: session.title === 'New session' && firstText?.type === 'text' ? firstText.text.slice(0, 60) : undefined,
  });

  repo.upsertMessages(db, session.id, [body.message]);

  const history: UIMessage[] = repo.getMessages(db, session.id).map(({ id, role, parts }) => ({ id, role, parts }));
  const tools = buildWorkflowTools(session.id);

  const result = streamText({
    model,
    instructions: buildInstructions({
      workflow: repo.getWorkflowState(db, session.id),
      memories: repo.listMemories(db, 'approved'),
      compaction: repo.getLatestSummary(db, session.id, 'compaction'),
    }),
    messages: await convertToModelMessages(history, { tools, ignoreIncompleteToolCalls: true }),
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
  });

  return result.toUIMessageStreamResponse({
    originalMessages: history,
    generateMessageId: createIdGenerator({ prefix: 'msg', size: 16 }),
    onError: (err) => (err instanceof Error ? err.message : String(err)),
    onEnd: async ({ messages }) => {
      // Skip empty assistant messages (e.g. the model call failed before producing anything).
      repo.upsertMessages(db, session.id, messages.filter((m) => m.parts.length > 0));
      try {
        const summary = await maybeCompact(db, session.id, model);
        if (summary) console.log(`[compaction] session ${session.id} compacted through seq ${summary.coversThroughSeq}`);
      } catch (err) {
        // Compaction is best-effort; the conversation still works without it.
        console.error('[compaction] failed:', err);
      }
    },
  });
}
