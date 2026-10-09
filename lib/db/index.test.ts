import { afterAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from './index';
import { getSession, renameSession } from './repo';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-migrate-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('openDb migrations', () => {
  it('adds title_custom to a database created before session renaming existed', () => {
    const file = path.join(dir, 'old.db');
    const old = new Database(file);
    old.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    old.prepare("INSERT INTO sessions VALUES ('s1', 'Old session', 'openai', 'gpt-5-mini', 'x', 'x')").run();
    old.close();

    const db = openDb(file);
    expect(getSession(db, 's1')).toMatchObject({ title: 'Old session', customTitle: false });
    expect(renameSession(db, 's1', 'Renamed').customTitle).toBe(true);
    db.close();

    // Opening again (e.g. by the second process) is a no-op and keeps the data.
    const again = openDb(file);
    expect(getSession(again, 's1')).toMatchObject({ title: 'Renamed', customTitle: true });
    again.close();
  });
});
