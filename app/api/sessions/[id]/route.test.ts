/** DELETE /api/sessions/[id] against a temp SQLite file. */
import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sessions-'));
process.env.AGENT_DB_PATH = path.join(dir, 'test.db');

const { DELETE, GET } = await import('./route');
const { getDb } = await import('@/lib/db');
const repo = await import('@/lib/db/repo');

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const url = (id: string) => `http://test/api/sessions/${id}`;

afterAll(() => {
  getDb().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('DELETE /api/sessions/[id]', () => {
  it('deletes the session, then reports it as missing', async () => {
    const { id } = repo.createSession(getDb(), { provider: 'openai', model: 'gpt-5-mini' });
    repo.createTask(getDb(), id, { title: 'Step' });

    const res = await DELETE(new Request(url(id), { method: 'DELETE' }), ctx(id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true, id });

    expect((await GET(new Request(url(id)), ctx(id))).status).toBe(404);
    expect(repo.listTasks(getDb(), id)).toEqual([]);

    const again = await DELETE(new Request(url(id), { method: 'DELETE' }), ctx(id));
    expect(again.status).toBe(404);
  });
});
