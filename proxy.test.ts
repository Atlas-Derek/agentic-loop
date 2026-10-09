import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';

const req = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(`http://localhost:3000${path}`, { method: init.method ?? 'GET', headers: { host: 'localhost:3000', ...init.headers } });

const json = { 'content-type': 'application/json' };
const passes = (res: Response) => res.headers.get('x-middleware-next') === '1';

afterEach(() => vi.unstubAllEnvs());

describe('proxy: API write protection', () => {
  it('allows same-origin JSON writes and all reads', () => {
    expect(passes(proxy(req('/api/chat', { method: 'POST', headers: { ...json, origin: 'http://localhost:3000' } })))).toBe(true);
    expect(passes(proxy(req('/api/sessions', { method: 'POST', headers: json })))).toBe(true); // no Origin (e.g. curl)
    expect(passes(proxy(req('/api/sessions')))).toBe(true);
  });

  it('rejects cross-origin writes', () => {
    const res = proxy(req('/api/memories/1', { method: 'PATCH', headers: { ...json, origin: 'https://evil.example' } }));
    expect(res.status).toBe(403);
  });

  it('rejects non-JSON writes, which a plain HTML form could send cross-site', () => {
    expect(proxy(req('/api/chat', { method: 'POST', headers: { 'content-type': 'text/plain' } })).status).toBe(415);
    expect(proxy(req('/api/chat', { method: 'POST' })).status).toBe(415);
  });
});

describe('proxy: optional password', () => {
  const basic = (user: string, pass: string) => ({ authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` });

  it('is off when APP_PASSWORD is unset', () => {
    expect(passes(proxy(req('/')))).toBe(true);
  });

  it('requires the password on pages and API routes when set', () => {
    vi.stubEnv('APP_PASSWORD', 's3cret:with-colon');
    const denied = proxy(req('/'));
    expect(denied.status).toBe(401);
    expect(denied.headers.get('www-authenticate')).toMatch(/^Basic/);
    expect(proxy(req('/api/sessions', { headers: basic('me', 'wrong') })).status).toBe(401);
    expect(passes(proxy(req('/api/sessions', { headers: basic('anyone', 's3cret:with-colon') })))).toBe(true);
  });
});
