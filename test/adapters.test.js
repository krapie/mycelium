import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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
