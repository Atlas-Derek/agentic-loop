import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Native module and the MCP SDK (which spawns child processes) must not be bundled.
  serverExternalPackages: ['better-sqlite3', '@modelcontextprotocol/sdk'],
  // The parent folder has its own package-lock.json; pin the project root to this folder.
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
