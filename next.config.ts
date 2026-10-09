import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV === 'development';

/**
 * Content Security Policy (Next's "without nonces" variant; the inline theme/layout scripts need 'unsafe-inline',
 * dev needs 'unsafe-eval' for React's debugging). The parts that matter here:
 * - img-src 'self': model-written markdown can't make the browser fetch a remote image (data exfiltration).
 * - default-src 'self': no requests to other origins at all, so leaked data has nowhere to go.
 * - frame-ancestors 'none': other sites can't frame the app and clickjack the memory "Approve" button.
 * No upgrade-insecure-requests: the app is served over plain HTTP on localhost.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const nextConfig: NextConfig = {
  // Native module and the MCP SDK (which spawns child processes) must not be bundled.
  serverExternalPackages: ['better-sqlite3', '@modelcontextprotocol/sdk'],
  // The parent folder has its own package-lock.json; pin the project root to this folder.
  turbopack: { root: import.meta.dirname },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' }, // frame-ancestors for older browsers
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ];
  },
};

export default nextConfig;
