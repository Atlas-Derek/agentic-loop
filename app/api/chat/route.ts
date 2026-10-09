/**
 * The agent loop.
 *
 * Per request: validate and persist the new user message, rebuild context from SQLite
 * (instructions + compaction summary + uncompacted history), stream the model
 * with the MCP-backed tools for up to MAX_STEPS tool/LLM round trips, then
 * persist the assistant message and compact if the session is getting long.
 */
import { convertToModelMessages, createIdGenerator, stepCountIs, streamText, type UIMessage } from 'ai';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import * as repo from '@/lib/db/repo';
import { getCompactionModel, getModel } from '@/lib/agent/model';
import { buildContextMessages, buildInstructions } from '@/lib/agent/prompt';
import { limitFinalStep } from '@/lib/agent/steps';
import { buildWorkflowTools } from '@/lib/agent/tools';
import { scheduleCompaction, waitForCompaction } from '@/lib/agent/compaction';

export const runtime = 'nodejs';
export const maxDuration = 120;

const MAX_STEPS = 12;
const MAX_MESSAGE_CHARS = 20_000;

/**
 * The client may only send one plain-text user message. History, assistant turns and tool
 * results come from SQLite, so a client cannot inject fake assistant or tool messages.
 * Unknown keys are stripped.
 */
const ChatBody = z.object({
  sessionId: z.string().min(1),
  provider: z.enum(['openai', 'google']),
  model: z.string().min(1),
  message: z.object({
    id: z.string().min(1).max(128),
    role: z.literal('user'),
    parts: z.array(z.object({ type: z.literal('text'), text: z.string().min(1).max(MAX_MESSAGE_CHARS) })).min(1),
  }),
});

const badRequest = (error: string, status = 400): Response => Response.json({ error }, { status });

export async function POST(req: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return badRequest('Request body must be JSON');
  }
  const parsed = ChatBody.safeParse(raw);
  if (!parsed.success) return badRequest(`Invalid request: ${z.prettifyError(parsed.error)}`);
  const body = parsed.data;
  const db = getDb();

  let model;
  let compactionModel;
  let session;
  try {
    session = repo.requireSession(db, body.sessionId);
    model = getModel(body.provider, body.model);
    compactionModel = getCompactionModel(body.provider);
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : String(err));
  }
  // Message ids are client-generated; never let a request overwrite stored history.
  if (repo.messageExists(db, body.message.id)) return badRequest(`Message ${body.message.id} already exists`, 409);

  // If the previous turn kicked off compaction, let it finish so context isn't built mid-compaction.
  await waitForCompaction(session.id);

  // Remember the model choice (switching mid-session is allowed) and title the session from its first
  // message, unless the user has already named it.
  const isFirstMessage = repo.getMessages(db, session.id, { includeCompacted: true }).length === 0;
  repo.updateSession(db, session.id, {
    provider: body.provider,
    model: body.model,
    autoTitle: isFirstMessage ? body.message.parts[0].text.slice(0, 60) : undefined,
  });

  repo.upsertMessages(db, session.id, [body.message]);

  const history: UIMessage[] = repo.getMessages(db, session.id).map(({ id, role, parts }) => ({ id, role, parts }));
  const tools = buildWorkflowTools(session.id);
  const workflow = repo.getWorkflowState(db, session.id);
  const instructions = buildInstructions({ workflow });

  const result = streamText({
    model,
    instructions,
    messages: [
      ...buildContextMessages({
        workflow,
        memories: repo.listMemories(db, 'approved'),
        compaction: repo.getLatestSummary(db, session.id, 'compaction'),
      }),
      ...(await convertToModelMessages(history, { tools, ignoreIncompleteToolCalls: true })),
    ],
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
    // Last step is text-only so a long turn ends with a progress reply instead of a bare tool call.
    prepareStep: limitFinalStep(MAX_STEPS, instructions),
    // Stop (or a closed tab) cancels the model call and any in-flight MCP tool call.
    abortSignal: req.signal,
  });

  return result.toUIMessageStreamResponse({
    originalMessages: history,
    generateMessageId: createIdGenerator({ prefix: 'msg', size: 16 }),
    onError: (err) => (err instanceof Error ? err.message : String(err)),
    onEnd: async ({ messages, isAborted, isCancelled }) => {
      // The session may have been deleted while this turn was streaming; there is nothing to save to.
      if (!repo.getSession(db, session.id)) return;
      // Skip empty assistant messages (e.g. the model call failed before producing anything).
      // Partial turns are still saved so the user sees what happened before they stopped.
      repo.upsertMessages(db, session.id, messages.filter((m) => m.parts.length > 0));
      // Don't spend a model call summarising a turn the user abandoned. Otherwise compact in the
      // background with the provider's cheap model, so the response closes without waiting for it.
      if (!isAborted && !isCancelled) scheduleCompaction(db, session.id, compactionModel);
    },
  });
}
