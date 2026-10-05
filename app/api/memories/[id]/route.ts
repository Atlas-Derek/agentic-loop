import { getDb } from '@/lib/db';
import { setMemoryStatus, type MemoryStatus } from '@/lib/db/repo';

export const runtime = 'nodejs';

const ALLOWED: MemoryStatus[] = ['approved', 'rejected', 'proposed'];

/** Human approval step for proposed memories. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const { status } = (await req.json()) as { status: MemoryStatus };
  if (!ALLOWED.includes(status)) return Response.json({ error: 'Invalid status' }, { status: 400 });
  try {
    return Response.json(setMemoryStatus(getDb(), Number(id), status));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 404 });
  }
}
