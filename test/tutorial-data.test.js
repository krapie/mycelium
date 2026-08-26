import test from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTERS } from '../src/adapters/index.js';
import { useTempHome } from './helpers.js';

// buildMockSessions() now defaults its `locale` param to i18n.js's
// getLocale(), which reads config.json — needs useTempHome() (and therefore
// a dynamic import, same pattern every other filesystem-backed test file in
// this directory uses) so it resolves against an isolated default ('en'),
// not whatever locale happens to be set in the real ~/.mycelium/config.json.
useTempHome();
const { buildMockSessions } = await import('../src/tui/tutorial-data.js');

const realSources = new Set(ADAPTERS.map((a) => a.name));

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

test('buildMockSessions(personaId, locale, projectDir) stamps every session with the given directory when provided, and omits it entirely otherwise', () => {
  const withDir = buildMockSessions('swe', 'en', '/fake/tutorial/repo');
  assert.ok(withDir.length > 0);
  for (const s of withDir) assert.equal(s.projectDir, '/fake/tutorial/repo');

  // No fs access here — buildMockSessions() stays pure; the caller
  // (tutorial.js's injectDemoSessions()) is the one that actually creates
  // the real directory before passing its path in. emptyNeutral()'s own
  // default (schema.js) is null, not undefined — left untouched when no
  // projectDir is given.
  const withoutDir = buildMockSessions('swe', 'en');
  for (const s of withoutDir) assert.equal(s.projectDir, null);
});

test('buildMockSessions() only uses real adapter sources', () => {
  // realSources is derived from the actual adapter registry (not a
  // hardcoded list) so this can't silently go stale again the way it
  // already had once — personas.js's mock sessions can freely use any real
  // adapter's source without this assertion needing a matching edit.
  const sessions = buildMockSessions();
  for (const s of sessions) assert.ok(realSources.has(s.source), s.source);
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
      assert.ok(realSources.has(s.source), `${personaId} session has unknown source ${s.source}`);
    }
  }
});

test('buildMockSessions(personaId, "ko") returns Korean title/summary/turns, same shape as English', () => {
  for (const [personaId, expectedCount] of [
    ['swe', 6],
    ['cse', 5],
    ['sa', 6],
  ]) {
    const en = buildMockSessions(personaId, 'en');
    const ko = buildMockSessions(personaId, 'ko');
    assert.equal(ko.length, expectedCount, `${personaId} ko session count`);
    assert.equal(ko.length, en.length, `${personaId} ko/en session counts must match`);
    for (let i = 0; i < ko.length; i++) {
      assert.ok(/[가-힣]/.test(ko[i].extracted.title), `${personaId} session ${i} title must contain Korean`);
      assert.ok(/[가-힣]/.test(ko[i].extracted.summary), `${personaId} session ${i} summary must contain Korean`);
      assert.equal(ko[i].turns.length, en[i].turns.length, `${personaId} session ${i} turn count must match between locales`);
      for (const t of ko[i].turns) assert.ok(/[가-힣]/.test(t.text), `${personaId} turn text must contain Korean`);
      // Locale-independent fields must be identical regardless of language.
      assert.equal(ko[i].source, en[i].source, `${personaId} session ${i} source must be locale-independent`);
      assert.deepEqual(ko[i].extracted.tags, en[i].extracted.tags, `${personaId} session ${i} tags must be locale-independent`);
    }
  }
});
