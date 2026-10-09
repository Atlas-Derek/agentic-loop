/** DELETE /api/sessions/[id] against a temp SQLite file. */
import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sessions-'));
process.env.AGENT_DB_PATH = path.join(dir, 'test.db');

const { DELETE, GET, PATCH } = await import('./route');
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

describe('PATCH /api/sessions/[id]', () => {
  const patch = (id: string, body: unknown) =>
    PATCH(new Request(url(id), { method: 'PATCH', body: typeof body === 'string' ? body : JSON.stringify(body) }), ctx(id));

  it('renames the session', async () => {
    const { id } = repo.createSession(getDb(), { provider: 'openai', model: 'gpt-5-mini' });
    const res = await patch(id, { title: ' Offsite planning ' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, title: 'Offsite planning', customTitle: true });
  });

  it('switches the model, alone or together with a rename', async () => {
    const { id } = repo.createSession(getDb(), { provider: 'openai', model: 'gpt-5-mini' });
    expect(await (await patch(id, { provider: 'openai', model: 'gpt-5' })).json()).toMatchObject({ model: 'gpt-5', customTitle: false });
    expect(await (await patch(id, { title: 'Both', provider: 'openai', model: 'gpt-5-mini' })).json()).toMatchObject({
      title: 'Both',
      model: 'gpt-5-mini',
    });
  });

  it('rejects invalid updates without changing anything', async () => {
    const { id } = repo.createSession(getDb(), { provider: 'openai', model: 'gpt-5-mini' });
    expect((await patch(id, { title: '   ' })).status).toBe(400);
    expect((await patch(id, { title: 'x'.repeat(81) })).status).toBe(400);
    expect((await patch(id, {})).status).toBe(400);
    expect((await patch(id, { provider: 'openai' })).status).toBe(400);
    expect((await patch(id, { provider: 'openai', model: 'nope' })).status).toBe(400);
    expect((await patch(id, 'not json')).status).toBe(400);
    // A bad name must not half-apply a model switch sent with it.
    expect((await patch(id, { title: '', provider: 'openai', model: 'gpt-5' })).status).toBe(400);
    expect(repo.requireSession(getDb(), id)).toMatchObject({ title: 'New session', model: 'gpt-5-mini', customTitle: false });
  });

  it('returns 404 for an unknown session', async () => {
    expect((await patch('missing', { title: 'Name' })).status).toBe(404);
  });
});
