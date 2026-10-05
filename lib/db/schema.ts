/**
 * SQLite schema. Shared by the Next.js server and the MCP server process,
 * which both open the same database file.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  provider    TEXT NOT NULL,
  model       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Every chat message, in order. Compacted messages are kept for debugging
-- but are no longer sent to the model.
CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  role        TEXT NOT NULL,
  parts_json  TEXT NOT NULL,
  compacted   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_session ON messages(session_id, seq);

CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  note        TEXT,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  tool_name   TEXT NOT NULL,
  input_json  TEXT NOT NULL,
  output_json TEXT,
  success     INTEGER NOT NULL,
  error       TEXT,
  duration_ms INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);

-- kind = 'compaction' (rolling summary of older messages) or 'final' (workflow done)
CREATE TABLE IF NOT EXISTS summaries (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id         TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind               TEXT NOT NULL,
  content            TEXT NOT NULL,
  covers_through_seq INTEGER,
  created_at         TEXT NOT NULL
);

-- Durable facts/preferences, global across sessions. Only 'approved' ones reach the model.
CREATE TABLE IF NOT EXISTS memories (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  content           TEXT NOT NULL,
  reason            TEXT,
  status            TEXT NOT NULL DEFAULT 'proposed',
  source_session_id TEXT,
  created_at        TEXT NOT NULL
);
`;
