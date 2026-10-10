import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { useTempHome } from './helpers.js';

useTempHome();

const { emptyNeutral } = await import('../src/schema.js');
const { DB_PATH, RAW_DIR } = await import('../src/paths.js');

// An index built before `host` existed: a sessions table without the column,
// holding a row, next to the raw record it was derived from.
mkdirSync(dirname(DB_PATH), { recursive: true });
mkdirSync(RAW_DIR, { recursive: true });
const old = new DatabaseSync(DB_PATH);
old.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, folder TEXT, started_at TEXT, preview TEXT, title TEXT, summary TEXT, organized_by TEXT, kind TEXT, done_at TEXT, continuation_of TEXT, continued_to TEXT, tags TEXT)');
old.prepare("INSERT INTO sessions (id, source) VALUES ('old-1', 'claude')").run();
old.close();
const rec = { ...emptyNeutral('old-1', 'claude'), host: 'homeserver' };
writeFileSync(`${RAW_DIR}/old-1.json`, JSON.stringify(rec));

const { listSessions, listHosts } = await import('../src/index-db.js');

test('an index from before the host column is rebuilt once so existing rows get their host', () => {
  assert.equal(listSessions({})[0].host, 'homeserver');
  assert.deepEqual(listHosts(), ['homeserver']);
});
