import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMockSessions } from '../src/tui/tutorial-data.js';

// Pure — no filesystem/MYCELIUM_HOME involvement, so a plain static import
// is fine here (unlike most other test files in this directory).

test('buildMockSessions() returns 6 fully-formed, unfiled demo sessions', () => {
  const sessions = buildMockSessions();
  assert.equal(sessions.length, 6);
  for (const s of sessions) {
    assert.equal(s.demo, true, 'every mock session must be tagged demo:true so tutorial.js can sweep it');
    assert.equal(s.folder, null, 'every mock session must start unfiled so the o step has real work to do');
    assert.ok(s.extracted.title, 'title must be pre-filled');
    assert.ok(s.extracted.summary, 'summary must be pre-filled');
    assert.ok(s.extracted.tags.length > 0, 'tags must be pre-filled');
    assert.ok(s.turns.length >= 2, 'each session needs a believable multi-turn conversation');
    assert.equal(s.summarizedTurnCount, s.turns.length);
  }
});

test('buildMockSessions() ids are unique', () => {
  const sessions = buildMockSessions();
  const ids = sessions.map((s) => s.id);
  assert.deepEqual(ids, [...new Set(ids)]);
});

test('buildMockSessions() only uses real adapter sources', () => {
  const sessions = buildMockSessions();
  for (const s of sessions) assert.ok(['claude', 'codex', 'kiro'].includes(s.source), s.source);
});
