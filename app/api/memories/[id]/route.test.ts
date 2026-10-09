/** PATCH /api/memories/[id] (the human approval step) against a temp SQLite file. */
import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-memories-'));
process.env.AGENT_DB_PATH = path.join(dir, 'test.db');

const { PATCH } = await import('./route');
const { getDb } = await import('@/lib/db');
const repo = await import('@/lib/db/repo');

const patch = (id: string, body: unknown) =>
  PATCH(
    new Request(`http://test/api/memories/${id}`, { method: 'PATCH', body: typeof body === 'string' ? body : JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );

afterAll(() => {
  getDb().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('PATCH /api/memories/[id]', () => {
  it('approves and rejects a proposed memory', async () => {
    const { id } = repo.proposeMemory(getDb(), { content: 'Prefers TypeScript' });

    const approved = await patch(String(id), { status: 'approved' });
    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({ id, status: 'approved' });
    expect(repo.listMemories(getDb(), 'approved').map((m) => m.id)).toContain(id);

    expect(await (await patch(String(id), { status: 'rejected' })).json()).toMatchObject({ id, status: 'rejected' });
    expect(repo.listMemories(getDb(), 'approved').map((m) => m.id)).not.toContain(id);
  });

  it('rejects bad ids and bodies without changing the memory', async () => {
    const { id } = repo.proposeMemory(getDb(), { content: 'Likes tabs' });

    expect((await patch('abc', { status: 'approved' })).status).toBe(400);
    expect((await patch('0', { status: 'approved' })).status).toBe(400);
    expect((await patch('1.5', { status: 'approved' })).status).toBe(400);
    expect((await patch(String(id), { status: 'active' })).status).toBe(400);
    expect((await patch(String(id), {})).status).toBe(400);
    expect((await patch(String(id), 'not json')).status).toBe(400);

    expect(repo.listMemories(getDb()).find((m) => m.id === id)?.status).toBe('proposed');
  });

  it('returns 404 for an unknown memory', async () => {
    expect((await patch('999999', { status: 'approved' })).status).toBe(404);
  });
});
