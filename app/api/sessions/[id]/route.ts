import { getDb } from '@/lib/db';
import * as repo from '@/lib/db/repo';
import { findModel } from '@/lib/models';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** Everything the UI needs to resume a session. `?debug=1` includes compacted messages. */
export async function GET(req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const db = getDb();
  const session = repo.getSession(db, id);
  if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
  const debug = new URL(req.url).searchParams.has('debug');
  return Response.json({
    session,
    // The chat shows the full history (including compacted messages) so the user sees the whole conversation;
    // `compacted` tells the UI which ones the model no longer sees verbatim.
    messages: repo.getMessages(db, id, { includeCompacted: true }),
    workflow: repo.getWorkflowState(db, id),
    toolCalls: repo.listToolCalls(db, id),
    compaction: repo.getLatestSummary(db, id, 'compaction'),
    finalSummary: repo.getLatestSummary(db, id, 'final'),
    ...(debug ? { activeMessages: repo.getMessages(db, id) } : {}),
  });
}

/** Switch the session's provider/model. */
export async function PATCH(req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const body = (await req.json()) as { provider: string; model: string };
  const choice = findModel(body.provider, body.model);
  if (!choice) return Response.json({ error: 'Unknown model' }, { status: 400 });
  try {
    return Response.json(repo.updateSession(getDb(), id, { provider: choice.provider, model: choice.id }));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 404 });
  }
}
