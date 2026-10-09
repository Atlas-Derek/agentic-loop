/**
 * Request guard in front of every page and API route (Next 16 `proxy`, formerly middleware).
 *
 * 1. Host allowlist: the Host header must be loopback (localhost, 127.0.0.1, [::1]) or listed in
 *    ALLOWED_HOSTS. This blocks DNS rebinding, where a malicious site points its own domain at
 *    127.0.0.1 so its page becomes "same-origin" with the app and can read and drive it.
 *    Any non-loopback host also requires APP_PASSWORD, so the app is never reachable from the
 *    network without a password.
 * 2. Optional password: if APP_PASSWORD is set, every request needs HTTP Basic auth (any username).
 *    The browser shows its own login prompt and then sends the credentials on page and fetch requests.
 *    Unset (the default) leaves local development unchanged.
 * 3. Always on: state-changing /api requests must be same-origin JSON. This blocks cross-site form
 *    posts, which could otherwise drive the agent or approve memories from another website.
 */
import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Lowercased hostname (no port) from a Host header, or null if it is missing or malformed. */
function hostnameOf(host: string | null): string | null {
  if (!host) return null;
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return null;
  }
}

/** Extra hostnames from ALLOWED_HOSTS (comma-separated, e.g. "myhost.lan,192.168.1.20"). */
function allowedHosts(): Set<string> {
  return new Set(
    (process.env.ALLOWED_HOSTS ?? '')
      .split(',')
      .map((h) => hostnameOf(h.trim()))
      .filter((h): h is string => h !== null),
  );
}

function passwordMatches(authorization: string | null, password: string): boolean {
  if (!authorization?.startsWith('Basic ')) return false;
  const decoded = Buffer.from(authorization.slice('Basic '.length), 'base64').toString('utf8');
  const given = Buffer.from(decoded.slice(decoded.indexOf(':') + 1));
  const expected = Buffer.from(password);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function proxy(req: NextRequest): NextResponse {
  const password = process.env.APP_PASSWORD;

  const hostname = hostnameOf(req.headers.get('host'));
  if (hostname === null || (!LOOPBACK_HOSTNAMES.has(hostname) && !allowedHosts().has(hostname))) {
    return new NextResponse('Host not allowed. Add it to ALLOWED_HOSTS (and set APP_PASSWORD) to serve it.', { status: 403 });
  }
  if (!LOOPBACK_HOSTNAMES.has(hostname) && !password) {
    return new NextResponse('APP_PASSWORD must be set to serve the app on a non-loopback host.', { status: 403 });
  }

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
