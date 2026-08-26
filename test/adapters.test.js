import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { ADAPTERS, getAdapter } from '../src/adapters/index.js';

// Adapters never touch MYCELIUM_HOME (they only read each CLI's own on-disk
// session store), so — unlike most other test files here — this one can use
// plain static imports.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

test('every adapter implements the full contract documented in adapters/base.js', () => {
  for (const a of ADAPTERS) {
    assert.equal(typeof a.name, 'string', `${a.name}: name`);
    assert.equal(typeof a.label, 'string', `${a.name}: label`);
    assert.equal(typeof a.bin, 'string', `${a.name}: bin`);
    assert.equal(typeof a.newArgs, 'function', `${a.name}: newArgs`);
    assert.equal(typeof a.resumeArgs, 'function', `${a.name}: resumeArgs`);
    assert.equal(typeof a.listSessions, 'function', `${a.name}: listSessions`);
    assert.equal(typeof a.parse, 'function', `${a.name}: parse`);
  }
});

test('getAdapter() finds an adapter by name and returns undefined for an unknown source', () => {
  assert.equal(getAdapter('claude').label, 'Claude Code');
  assert.equal(getAdapter('codex').label, 'Codex');
  assert.equal(getAdapter('kiro').label, 'Kiro');
  assert.equal(getAdapter('opencode').label, 'OpenCode');
  assert.equal(getAdapter('some-future-agent'), undefined);
});

test('adapter names are unique and match what newArgs/resumeArgs are keyed on elsewhere', () => {
  const names = ADAPTERS.map((a) => a.name);
  assert.deepEqual(names, [...new Set(names)]);
});

test('claude adapter parses turns, cwd, and tool activity out of a real-shaped transcript', () => {
  const claude = getAdapter('claude');
  const neutral = claude.parse({ id: 'test-claude', path: join(FIXTURES, 'claude-sample.jsonl'), mtimeMs: 0 });
  assert.equal(neutral.source, 'claude');
  assert.equal(neutral.cwd, '/tmp/proj');
  assert.equal(neutral.turns.length, 2);
  assert.equal(neutral.turns[0].role, 'user');
  assert.match(neutral.turns[0].text, /login bug/);
  assert.equal(neutral.turns[1].role, 'assistant');
  assert.deepEqual(neutral.artifacts.filesChanged, ['src/auth.ts']);
});

test('codex adapter parses session_meta + event_msg lines into turns', () => {
  const codex = getAdapter('codex');
  const neutral = codex.parse({ id: 'test-codex', path: join(FIXTURES, 'codex-sample.jsonl'), mtimeMs: 0 });
  assert.equal(neutral.source, 'codex');
  assert.equal(neutral.cwd, '/tmp/proj');
  assert.equal(neutral.turns.length, 2);
  assert.deepEqual(
    neutral.turns.map((t) => t.role),
    ['user', 'assistant'],
  );
});

test('kiro adapter parses its JSONL fallback format into turns', () => {
  const kiro = getAdapter('kiro');
  const neutral = kiro.parse({
    id: 'test-kiro',
    path: join(FIXTURES, 'kiro-sample.jsonl'),
    mtimeMs: 0,
    _kind: 'jsonl',
    _cwd: '/tmp/proj',
    _createdAt: '2024-01-01T00:00:00.000Z',
    _updatedAt: '2024-01-01T00:00:05.000Z',
  });
  assert.equal(neutral.source, 'kiro');
  assert.equal(neutral.cwd, '/tmp/proj');
  assert.equal(neutral.turns.length, 2);
  assert.equal(neutral.turns[0].role, 'user');
  assert.equal(neutral.turns[1].role, 'assistant');
});

// opencode stores everything in one SQLite DB (session/project/message/part),
// not per-session files — build a throwaway DB matching the real verified
// schema instead of a fixture file, so this test also documents the shape.
test('opencode adapter parses session/message/part rows out of a real-shaped SQLite DB', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mycelium-opencode-test-'));
  const dbPath = join(dir, 'opencode.db');
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT);
    CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, time_created INTEGER, data TEXT);
  `);
  db.prepare('INSERT INTO project (id, worktree) VALUES (?, ?)').run('proj1', '/tmp/proj');
  db.prepare('INSERT INTO session (id, project_id, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?)').run(
    'ses1',
    'proj1',
    '/tmp/proj',
    1700000000000,
    1700000005000,
  );
  db.prepare('INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)').run(
    'msg1',
    'ses1',
    1700000000000,
    JSON.stringify({ role: 'user' }),
  );
  db.prepare('INSERT INTO part (id, message_id, time_created, data) VALUES (?, ?, ?, ?)').run(
    'prt1',
    'msg1',
    1700000000000,
    JSON.stringify({ type: 'text', text: 'fix the login bug' }),
  );
  db.prepare('INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)').run(
    'msg2',
    'ses1',
    1700000001000,
    JSON.stringify({ role: 'assistant' }),
  );
  db.prepare('INSERT INTO part (id, message_id, time_created, data) VALUES (?, ?, ?, ?)').run(
    'prt2',
    'msg2',
    1700000001000,
    JSON.stringify({ type: 'reasoning', text: 'thinking about it' }),
  );
  db.prepare('INSERT INTO part (id, message_id, time_created, data) VALUES (?, ?, ?, ?)').run(
    'prt3',
    'msg2',
    1700000002000,
    JSON.stringify({ type: 'tool', tool: 'edit', state: { input: { filePath: 'src/auth.ts' }, output: 'huge diff, never captured' } }),
  );
  db.prepare('INSERT INTO part (id, message_id, time_created, data) VALUES (?, ?, ?, ?)').run(
    'prt4',
    'msg2',
    1700000003000,
    JSON.stringify({ type: 'text', text: 'fixed it' }),
  );
  db.close();

  const opencode = getAdapter('opencode');
  const neutral = opencode.parse({ id: 'ses1', path: dbPath, mtimeMs: 1700000005000 });

  assert.equal(neutral.source, 'opencode');
  assert.equal(neutral.cwd, '/tmp/proj');
  assert.equal(neutral.projectDir, '/tmp/proj');
  assert.equal(neutral.startedAt, new Date(1700000000000).toISOString());
  assert.equal(neutral.endedAt, new Date(1700000005000).toISOString());
  assert.equal(neutral.turns.length, 2);
  assert.equal(neutral.turns[0].role, 'user');
  assert.match(neutral.turns[0].text, /login bug/);
  assert.equal(neutral.turns[1].role, 'assistant');
  // 'reasoning' text must not leak into the visible turn — only 'text' parts do.
  assert.doesNotMatch(neutral.turns[1].text, /thinking about it/);
  assert.match(neutral.turns[1].text, /fixed it/);
  assert.deepEqual(neutral.toolActivity, ['edit: src/auth.ts']);
  assert.deepEqual(neutral.artifacts.filesChanged, ['src/auth.ts']);
  // never the full tool payload — only the path summary.
  assert.ok(!neutral.toolActivity.some((a) => a.includes('huge diff')));
});

test('opencode adapter falls back to session.directory when the project is the synthetic global worktree', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mycelium-opencode-test-'));
  const dbPath = join(dir, 'opencode.db');
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT);
    CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, time_created INTEGER, data TEXT);
  `);
  db.prepare('INSERT INTO project (id, worktree) VALUES (?, ?)').run('global', '/');
  db.prepare('INSERT INTO session (id, project_id, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?)').run(
    'ses2',
    'global',
    '/Users/someone',
    1700000000000,
    1700000000000,
  );
  db.close();

  const opencode = getAdapter('opencode');
  const neutral = opencode.parse({ id: 'ses2', path: dbPath, mtimeMs: 1700000000000 });
  assert.equal(neutral.cwd, '/Users/someone');
  assert.equal(neutral.projectDir, '/Users/someone');
});

// A bash/search tool's raw input can carry secrets a user never typed for
// Mycelium to keep (e.g. `export API_KEY=...`) — toolTarget() must only
// ever echo filePath, never command/pattern/query, even though the other
// three adapters' equivalent summaries aren't this strict.
test('opencode adapter never echoes a tool\'s raw command/query into toolActivity, only filePath', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mycelium-opencode-test-'));
  const dbPath = join(dir, 'opencode.db');
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT);
    CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, time_created INTEGER, data TEXT);
  `);
  db.prepare('INSERT INTO project (id, worktree) VALUES (?, ?)').run('proj1', '/tmp/proj');
  db.prepare('INSERT INTO session (id, project_id, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?)').run(
    'ses3',
    'proj1',
    '/tmp/proj',
    1700000000000,
    1700000000000,
  );
  db.prepare('INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)').run(
    'msg1',
    'ses3',
    1700000000000,
    JSON.stringify({ role: 'assistant' }),
  );
  db.prepare('INSERT INTO part (id, message_id, time_created, data) VALUES (?, ?, ?, ?)').run(
    'prt1',
    'msg1',
    1700000000000,
    JSON.stringify({ type: 'tool', tool: 'bash', state: { input: { command: 'export API_KEY=sk-super-secret' } } }),
  );
  db.prepare('INSERT INTO part (id, message_id, time_created, data) VALUES (?, ?, ?, ?)').run(
    'prt2',
    'msg1',
    1700000001000,
    JSON.stringify({ type: 'tool', tool: 'websearch', state: { input: { query: 'our internal roadmap for project X' } } }),
  );
  db.close();

  const opencode = getAdapter('opencode');
  const neutral = opencode.parse({ id: 'ses3', path: dbPath, mtimeMs: 1700000000000 });

  assert.deepEqual(neutral.toolActivity, ['bash', 'websearch']);
  const joined = neutral.toolActivity.join(' ');
  assert.ok(!joined.includes('API_KEY'), 'raw bash command must never be persisted');
  assert.ok(!joined.includes('roadmap'), 'raw search query must never be persisted');
});
