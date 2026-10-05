import { getDb } from '@/lib/db';
import * as repo from '@/lib/db/repo';
import { configuredProviders } from '@/lib/agent/model';
import { DEFAULT_MODEL, findModel } from '@/lib/models';

export const runtime = 'nodejs';

/** List sessions, plus which providers have API keys (for the model selector). */
export async function GET(): Promise<Response> {
  return Response.json({ sessions: repo.listSessions(getDb()), providers: configuredProviders() });
}

/** Create a session with the chosen (or default) model. */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { provider?: string; model?: string };
  const choice = body.provider && body.model ? findModel(body.provider, body.model) : DEFAULT_MODEL;
  if (!choice) return Response.json({ error: 'Unknown model' }, { status: 400 });
  return Response.json(repo.createSession(getDb(), { provider: choice.provider, model: choice.id }));
}
