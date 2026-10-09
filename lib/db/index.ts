import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA } from './schema.ts';

export type DB = Database.Database;

/** Open (and initialise) a database. Pass ':memory:' in tests. */
export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  // WAL lets the Next.js server and the MCP server process read/write the same file safely.
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/**
 * Bring databases created by older versions up to date (CREATE TABLE IF NOT EXISTS won't add columns).
 * IMMEDIATE takes the write lock before checking, so the Next.js server and the MCP server can both
 * open the same file at startup without racing to add the same column.
 */
function migrate(db: DB): void {
  db.transaction(() => {
    const columns = db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[];
    if (!columns.some((c) => c.name === 'title_custom')) {
      db.exec('ALTER TABLE sessions ADD COLUMN title_custom INTEGER NOT NULL DEFAULT 0');
    }
  }).immediate();
}

export function defaultDbPath(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.AGENT_DB_PATH ?? 'data/agent.db');
}

const globalForDb = globalThis as unknown as { __agentDb?: DB };

/** Process-wide singleton, cached on globalThis so Next dev hot reloads reuse it. */
export function getDb(): DB {
  globalForDb.__agentDb ??= openDb(defaultDbPath());
  return globalForDb.__agentDb;
}
