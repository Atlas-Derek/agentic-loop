import { z } from 'zod';
import { getDb } from '@/lib/db';
import { setMemoryStatus } from '@/lib/db/repo';

export const runtime = 'nodejs';

const PatchBody = z.object({ status: z.enum(['approved', 'rejected', 'proposed']) });
const MemoryId = z.coerce.number().int().positive();

/** Human approval step for proposed memories. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = MemoryId.safeParse((await params).id);
  if (!id.success) return Response.json({ error: 'Invalid memory id' }, { status: 400 });
  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  try {
    return Response.json(setMemoryStatus(getDb(), id.data, parsed.data.status));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 404 });
  }
}
