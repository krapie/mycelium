import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { useTempHome } from './helpers.js';

useTempHome();

const { emptyNeutral } = await import('../src/schema.js');
const { DB_PATH, RAW_DIR } = await import('../src/paths.js');

// An index from before `work_dir` (and `host`) existed, holding one row whose
// raw record knows the directory it ran in.
mkdirSync(dirname(DB_PATH), { recursive: true });
mkdirSync(RAW_DIR, { recursive: true });
const old = new DatabaseSync(DB_PATH);
old.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, folder TEXT, started_at TEXT, preview TEXT, title TEXT, summary TEXT, organized_by TEXT, kind TEXT, done_at TEXT, continuation_of TEXT, continued_to TEXT, tags TEXT)');
old.prepare("INSERT INTO sessions (id, source) VALUES ('old-1', 'claude')").run();
old.close();
const rec = { ...emptyNeutral('old-1', 'claude'), projectDir: '/work/app' };
writeFileSync(`${RAW_DIR}/old-1.json`, JSON.stringify(rec));

const { listSessions } = await import('../src/index-db.js');

test('an index from before work_dir is rebuilt once so existing rows can be filtered by directory', () => {
  assert.equal(listSessions({ dir: '/work/app' }).length, 1);
  assert.equal(listSessions({ dir: '/work/app/src' }).length, 0);
  assert.equal(listSessions({ dir: '/work/other' }).length, 0);
});
