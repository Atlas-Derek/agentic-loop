import { z } from 'zod';
import { getDb } from '@/lib/db';
import * as repo from '@/lib/db/repo';
import { findModel } from '@/lib/models';
import { waitForCompaction } from '@/lib/agent/compaction';

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

/** Rename the session and/or switch its provider/model (provider and model must be sent together). */
const PatchBody = z
  .object({ title: z.string().optional(), provider: z.string().optional(), model: z.string().optional() })
  .refine((b) => (b.provider === undefined) === (b.model === undefined), { message: 'Send provider and model together' })
  .refine((b) => b.title !== undefined || b.provider !== undefined, { message: 'Nothing to update' });

export async function PATCH(req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  const body = parsed.data;

  const db = getDb();
  if (!repo.getSession(db, id)) return Response.json({ error: 'Session not found' }, { status: 404 });

  const choice = body.provider !== undefined && body.model !== undefined ? findModel(body.provider, body.model) : null;
  if (body.provider !== undefined && !choice) return Response.json({ error: 'Unknown model' }, { status: 400 });

  try {
    // Validate the rename first so a bad name doesn't leave a half-applied update.
    let session = body.title !== undefined ? repo.renameSession(db, id, body.title) : repo.requireSession(db, id);
    if (choice) session = repo.updateSession(db, id, { provider: choice.provider, model: choice.id });
    return Response.json(session);
  } catch (err) {
    // The session exists (checked above), so remaining domain errors are invalid input, e.g. an empty name.
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

/** Permanently delete a session and everything stored for it (memories are global and kept). */
export async function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  // Let any background compaction for this session finish first, so it doesn't write to a deleted session.
  await waitForCompaction(id);
  try {
    repo.deleteSession(getDb(), id);
    return Response.json({ deleted: true, id });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 404 });
  }
}
