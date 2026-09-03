import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceLabel, sourceColor, C } from '../src/tui/theme.js';

test('sourceLabel() maps each real source to its adapter name, plus the merged pseudo-source', () => {
  assert.equal(sourceLabel('claude'), 'claude');
  assert.equal(sourceLabel('codex'), 'codex');
  assert.equal(sourceLabel('merged'), 'merged');
});

// Regression: a backlog item (backlog.js) has no source. sourceLabel() used to
// hand back the null straight through, which rendered as a literal
// "null #1234abcd" in the detail panel's continuation link and threw
// (.localeCompare of null) in the sessions list's sort-by-agent comparator.
test('sourceLabel() never returns null — a source-less record reads as a backlog item', () => {
  assert.equal(sourceLabel(null), 'backlog');
  assert.equal(sourceLabel(undefined), 'backlog');
  assert.doesNotThrow(() => sourceLabel(null).localeCompare(sourceLabel('claude')));
});

test('sourceColor() gives a source-less record the backlog accent, not the claude one', () => {
  assert.equal(sourceColor(null), C.fox);
  assert.equal(sourceColor('claude'), C.claude);
  assert.equal(sourceColor('nope'), C.claude);
});
