import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyNeutral } from '../src/schema.js';
import { mergeSession } from '../src/sync/merge.js';

function rec(overrides = {}) {
  return { ...emptyNeutral('m-1', 'claude'), host: 'laptop', updatedAt: '2026-10-01T00:00:00.000Z', ...overrides };
}
const turns = (n) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `t${i}` }));

test('a field only one side changed is taken from that side', () => {
  const base = rec();
  const ours = rec({ folder: 'work', organizedBy: 'human', updatedAt: '2026-10-02T00:00:00.000Z' });
  const theirs = rec({ humanTags: ['urgent'], updatedAt: '2026-10-03T00:00:00.000Z' });
  const out = mergeSession(base, ours, theirs);
  assert.equal(out.folder, 'work');
  assert.equal(out.organizedBy, 'human');
  assert.deepEqual(out.humanTags, ['urgent']);
  assert.equal(out.updatedAt, '2026-10-03T00:00:00.000Z');
});

test('a human placement beats an automatic one even when the automatic one is newer', () => {
  const base = rec();
  const ours = rec({ folder: 'mine', organizedBy: 'human', updatedAt: '2026-10-02T00:00:00.000Z' });
  const theirs = rec({ folder: 'guessed', organizedBy: 'auto', updatedAt: '2026-10-05T00:00:00.000Z' });
  const out = mergeSession(base, ours, theirs);
  assert.equal(out.folder, 'mine');
  assert.equal(out.organizedBy, 'human');
});

test('two human placements: the newer one wins', () => {
  const base = rec();
  const ours = rec({ folder: 'a', organizedBy: 'human', updatedAt: '2026-10-02T00:00:00.000Z' });
  const theirs = rec({ folder: 'b', organizedBy: 'human', updatedAt: '2026-10-04T00:00:00.000Z' });
  assert.equal(mergeSession(base, ours, theirs).folder, 'b');
});

test('the longer transcript wins, and its capture fields travel together', () => {
  const base = rec({ turns: turns(2), endedAt: 'e2', _mtimeMs: 2 });
  const ours = rec({ turns: turns(4), endedAt: 'e4', _mtimeMs: 4 });
  const theirs = rec({ turns: turns(3), endedAt: 'e3', _mtimeMs: 3 });
  const out = mergeSession(base, ours, theirs);
  assert.equal(out.turns.length, 4);
  assert.equal(out.endedAt, 'e4');
  assert.equal(out._mtimeMs, 4);
});

test('the summary covering more of the transcript wins, but a locked human title survives', () => {
  const base = rec();
  const ours = rec({ extracted: { ...base.extracted, title: 'My title' }, titleLocked: true });
  const theirs = rec({ extracted: { ...base.extracted, title: 'LLM title', summary: 'fresh' }, summarizedTurnCount: 10 });
  const out = mergeSession(base, ours, theirs);
  assert.equal(out.extracted.summary, 'fresh');
  assert.equal(out.extracted.title, 'My title');
  assert.equal(out.titleLocked, true);
});

test('lineage arrays both sides grew are unioned', () => {
  const base = rec({ continuedTo: ['x'] });
  const ours = rec({ continuedTo: ['x', 'y'] });
  const theirs = rec({ continuedTo: ['x', 'z'] });
  assert.deepEqual(mergeSession(base, ours, theirs).continuedTo, ['x', 'y', 'z']);
});

test('a removal on one side is kept when the other side left the field alone', () => {
  const base = rec({ continuedTo: ['gone'] });
  const ours = rec({ continuedTo: [] });
  const theirs = rec({ continuedTo: ['gone'], folder: 'f', organizedBy: 'human' });
  const out = mergeSession(base, ours, theirs);
  assert.deepEqual(out.continuedTo, []);
  assert.equal(out.folder, 'f');
});

test('no common ancestor (both stores added the record) still merges', () => {
  const ours = rec({ turns: turns(2) });
  const theirs = rec({ turns: turns(2), folder: 'f', organizedBy: 'human' });
  const out = mergeSession(null, ours, theirs);
  assert.equal(out.folder, 'f');
  assert.equal(out.turns.length, 2);
});

test('where a record came from never changes: the ancestor\'s host wins over a later writer\'s', () => {
  const base = rec({ host: 'laptop' });
  const out = mergeSession(base, rec({ host: 'server', folder: 'a', organizedBy: 'human' }), rec({ host: 'other', folder: 'b' }));
  assert.equal(out.host, 'laptop');
  // A record that arrived without one picks up the side that has it.
  const fill = mergeSession(rec({ host: null }), rec({ host: null, folder: 'f' }), rec({ host: 'laptop' }));
  assert.equal(fill.host, 'laptop');
});
