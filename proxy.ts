/**
 * Request guard in front of every page and API route (Next 16 `proxy`, formerly middleware).
 *
 * 1. Optional password: if APP_PASSWORD is set, every request needs HTTP Basic auth (any username).
 *    The browser shows its own login prompt and then sends the credentials on page and fetch requests.
 *    Unset (the default) leaves local development unchanged.
 * 2. Always on: state-changing /api requests must be same-origin JSON. This blocks cross-site form
 *    posts, which could otherwise drive the agent or approve memories from another website.
 */
import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function passwordMatches(authorization: string | null, password: string): boolean {
  if (!authorization?.startsWith('Basic ')) return false;
  const decoded = Buffer.from(authorization.slice('Basic '.length), 'base64').toString('utf8');
  const given = Buffer.from(decoded.slice(decoded.indexOf(':') + 1));
  const expected = Buffer.from(password);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function proxy(req: NextRequest): NextResponse {
  const password = process.env.APP_PASSWORD;
  if (password && !passwordMatches(req.headers.get('authorization'), password)) {
    return new NextResponse('Authentication required', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="agentic-loop", charset="UTF-8"' },
    });
  }

  if (req.nextUrl.pathname.startsWith('/api/') && !SAFE_METHODS.has(req.method)) {
    const origin = req.headers.get('origin');
    if (origin !== null && new URL(origin).host !== req.headers.get('host')) {
      return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 });
    }
    if (!req.headers.get('content-type')?.includes('application/json')) {
      return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
