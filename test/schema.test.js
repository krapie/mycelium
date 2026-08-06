import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyNeutral, firstUserText, firstUserTurn, searchableText } from '../src/schema.js';

test('emptyNeutral() stamps id/source and leaves everything else at documented defaults', () => {
  const n = emptyNeutral('abc123', 'claude');
  assert.equal(n.id, 'abc123');
  assert.equal(n.source, 'claude');
  assert.equal(n.folder, null);
  assert.equal(n.organizedBy, 'auto');
  assert.deepEqual(n.turns, []);
  assert.deepEqual(n.artifacts, { filesChanged: [], diffSummary: null });
  assert.deepEqual(n.extracted, { title: null, tags: [], summary: null, decisions: [], todos: [] });
  assert.equal(n.titleLocked, false);
  assert.equal(n.summarizedTurnCount, null);
});

test('firstUserText() skips synthetic XML-tag turns and returns the first real user message', () => {
  const n = emptyNeutral('id', 'claude');
  n.turns = [
    { role: 'user', text: '<local-command-caveat>ignore me</local-command-caveat>' },
    { role: 'assistant', text: 'hi' },
    { role: 'user', text: 'fix the login bug' },
  ];
  assert.equal(firstUserText(n), 'fix the login bug');
});

test('firstUserText() returns empty string when there is no real user turn', () => {
  const n = emptyNeutral('id', 'claude');
  n.turns = [{ role: 'user', text: '<system-reminder>only synthetic</system-reminder>' }];
  assert.equal(firstUserText(n), '');
});

test('firstUserTurn() returns the untruncated turn object, skipping synthetic turns', () => {
  const n = emptyNeutral('id', 'claude');
  const longText = 'x'.repeat(500); // longer than firstUserText()'s 200-char preview cap
  n.turns = [
    { role: 'user', text: '<bash-input>ignore me</bash-input>' },
    { role: 'user', text: longText },
  ];
  const turn = firstUserTurn(n);
  assert.equal(turn.text, longText);
  // firstUserText() truncates for a short list preview; firstUserTurn() is
  // the untruncated turn callers needing more (handoff.js, insight.js) build
  // their own excerpt length from.
  assert.equal(firstUserText(n).length, 200);
});

test('firstUserTurn() returns null when there is no real user turn', () => {
  const n = emptyNeutral('id', 'claude');
  n.turns = [{ role: 'user', text: '<system-reminder>only synthetic</system-reminder>' }];
  assert.equal(firstUserTurn(n), null);
});

test('searchableText() joins turn text, tool activity, and the extracted summary', () => {
  const n = emptyNeutral('id', 'claude');
  n.turns = [{ role: 'user', text: 'hello' }];
  n.toolActivity = ['Edit src/auth.ts'];
  n.extracted.summary = 'fixed auth';
  const text = searchableText(n);
  assert.match(text, /hello/);
  assert.match(text, /Edit src\/auth\.ts/);
  assert.match(text, /fixed auth/);
});

// Formerly a documented inconsistency: handoff.js and insight.js each used
// to pick the first user turn with their own inline `turns.find(t => t.role
// === 'user')`, bypassing this file's synthetic-turn skip entirely. Both now
// call firstUserTurn() (see src/handoff.js, src/insight.js) — this test
// pins that firstUserText()'s preview and firstUserTurn()'s full turn agree
// on which turn is "the" first real user turn, which is what every caller
// (session-list previews, handoff.js, insight.js) now shares.
test('firstUserText() and firstUserTurn() agree on which turn is the first real user turn', () => {
  const n = emptyNeutral('id', 'claude');
  n.turns = [
    { role: 'user', text: '<local-command-caveat>ignore me</local-command-caveat>' },
    { role: 'assistant', text: 'hi' },
    { role: 'user', text: 'fix the login bug' },
  ];
  assert.equal(firstUserText(n), 'fix the login bug');
  assert.equal(firstUserTurn(n).text, 'fix the login bug');
});
