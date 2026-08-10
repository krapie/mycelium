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

test('buildMockSessions() supports every persona, each fully-formed and unfiled', () => {
  // swe: 3 storylines x 2 sessions. cse: 3 + 2 (its merge storyline is a
  // 3-way merge). sa: 3 storylines x 2 sessions.
  for (const [personaId, expectedCount] of [
    ['swe', 6],
    ['cse', 5],
    ['sa', 6],
  ]) {
    const sessions = buildMockSessions(personaId);
    assert.equal(sessions.length, expectedCount, `${personaId} session count`);
    const ids = sessions.map((s) => s.id);
    assert.deepEqual(ids, [...new Set(ids)], `${personaId} ids must be unique`);
    for (const s of sessions) {
      assert.equal(s.demo, true, `${personaId} session must be demo:true`);
      assert.equal(s.folder, null, `${personaId} session must start unfiled`);
      assert.ok(s.extracted.title, `${personaId} session needs a title`);
      assert.ok(s.turns.length >= 2, `${personaId} session needs a believable conversation`);
    }
  }
});
