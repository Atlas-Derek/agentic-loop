import { getDb } from '@/lib/db';
import { listMemories } from '@/lib/db/repo';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  return Response.json(listMemories(getDb()));
}
