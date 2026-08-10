import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers.js';

useTempHome();

const { emptyNeutral } = await import('../src/schema.js');
const { loadRaw, saveRaw } = await import('../src/scanner.js');
const { TREE_DIR } = await import('../src/paths.js');
const { __setTestProvider, __clearTestProvider } = await import('../src/llm.js');
const organize = await import('../src/organize.js');
const {
  mkdir,
  move,
  tag,
  setContent,
  deleteSession,
  linkContinuation,
  mergeSessions,
  unmerge,
  renameFolder,
  deleteFolder,
  isArchive,
  isSuperseded,
  classificationCandidates,
  summarizeCandidates,
  suggestPlacements,
  queueSuggestions,
  pendingSuggestions,
  clearSuggestions,
  applyPlacements,
} = organize;

test.afterEach(() => __clearTestProvider());

function seed(id, overrides = {}) {
  const n = { ...emptyNeutral(id, 'claude'), ...overrides };
  saveRaw(n);
  return n;
}

test('isArchive() matches _archive itself and anything nested under it, not lookalikes', () => {
  assert.equal(isArchive('_archive'), true);
  assert.equal(isArchive('_archive/old'), true);
  assert.equal(isArchive('_archived'), false);
  assert.equal(isArchive(null), false);
  assert.equal(isArchive(undefined), false);
});

test('isSuperseded() is true only when supersededBy is non-empty', () => {
  assert.equal(isSuperseded({ supersededBy: [] }), false);
  assert.equal(isSuperseded({ supersededBy: ['x'] }), true);
  assert.equal(isSuperseded({}), false);
});

test('mkdir() creates the real tree directory and is idempotent', () => {
  mkdir('a/b/c');
  assert.ok(existsSync(join(TREE_DIR, 'a', 'b', 'c')));
  assert.doesNotThrow(() => mkdir('a/b/c'));
});

test('move() files a session, creates the folder, and marks it human-owned', () => {
  seed('mv-1');
  const res = move('mv-1', 'work/proj');
  assert.equal(res.ok, true);
  assert.equal(res.session.folder, 'work/proj');
  assert.equal(res.session.organizedBy, 'human');
  assert.ok(existsSync(join(TREE_DIR, 'work', 'proj')));
});

test('move() to null/empty unfiles the session (folder becomes null)', () => {
  seed('mv-2', { folder: 'somewhere' });
  const res = move('mv-2', null);
  assert.equal(res.session.folder, null);
});

test('move() on a missing session returns ok:false', () => {
  const res = move('does-not-exist', 'x');
  assert.equal(res.ok, false);
});

test('tag() adds and removes tags, and marks the session human-owned', () => {
  seed('tag-1', { extracted: { title: null, tags: ['old'], summary: null, decisions: [], todos: [] } });
  const res = tag('tag-1', ['new'], ['old']);
  assert.equal(res.ok, true);
  assert.deepEqual(res.session.extracted.tags, ['new']);
  assert.equal(res.session.organizedBy, 'human');
});

test('tag() de-duplicates via a Set when adding an already-present tag', () => {
  seed('tag-2', { extracted: { title: null, tags: ['dup'], summary: null, decisions: [], todos: [] } });
  const res = tag('tag-2', ['dup']);
  assert.deepEqual(res.session.extracted.tags, ['dup']);
});

test('setContent() sets and locks the title; empty string clears + unlocks it', () => {
  seed('set-1');
  const res1 = setContent('set-1', { title: 'My Title' });
  assert.equal(res1.session.extracted.title, 'My Title');
  assert.equal(res1.session.titleLocked, true);

  const res2 = setContent('set-1', { title: '' });
  assert.equal(res2.session.extracted.title, null);
  assert.equal(res2.session.titleLocked, false);
});

test('setContent() sets summary independently of title', () => {
  seed('set-2');
  const res = setContent('set-2', { summary: 'a short summary' });
  assert.equal(res.session.extracted.summary, 'a short summary');
  assert.equal(res.session.titleLocked, false);
});

test('deleteSession() removes the raw file and adds the id to config.excludedSessionIds', async () => {
  seed('del-1');
  const res = deleteSession('del-1');
  assert.equal(res.ok, true);
  assert.equal(loadRaw('del-1'), null);
  const { loadConfig } = await import('../src/config.js');
  assert.ok(loadConfig().excludedSessionIds.includes('del-1'));
});

test('deleteSession() sweeps backlinks off every other session pointing at it', () => {
  seed('del-target');
  seed('linker', {
    continuedTo: ['del-target'],
    mergedFrom: ['del-target'],
    supersededBy: ['del-target'],
    splitInto: ['del-target'],
  });
  const res = deleteSession('del-target');
  assert.deepEqual(res.touchedIds, ['linker']);
  const linker = loadRaw('linker');
  assert.deepEqual(linker.continuedTo, []);
  assert.deepEqual(linker.mergedFrom, []);
  assert.deepEqual(linker.supersededBy, []);
  assert.deepEqual(linker.splitInto, []);
});

test('deleteSession() on a missing session returns ok:false', () => {
  const res = deleteSession('nope');
  assert.equal(res.ok, false);
});

test('linkContinuation() links both directions and is idempotent on the parent side', () => {
  seed('child-1');
  seed('parent-1');
  linkContinuation('child-1', 'parent-1');
  linkContinuation('child-1', 'parent-1'); // calling twice must not duplicate the child id
  assert.equal(loadRaw('child-1').continuationOf, 'parent-1');
  assert.deepEqual(loadRaw('parent-1').continuedTo, ['child-1']);
});

test('linkContinuation() is a no-op when child and parent are the same id', () => {
  seed('self-1');
  linkContinuation('self-1', 'self-1');
  assert.equal(loadRaw('self-1').continuationOf, null);
});

test('mergeSessions() requires at least 2 valid sessions', () => {
  seed('only-one');
  const res = mergeSessions(['only-one']);
  assert.equal(res.ok, false);
});

test('mergeSessions() combines turns in startedAt order, tags originals with supersededBy, and is reversible via unmerge()', () => {
  seed('m-1', { startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T01:00:00.000Z', turns: [{ role: 'user', text: 'first' }] });
  seed('m-2', { startedAt: '2026-01-02T00:00:00.000Z', endedAt: '2026-01-02T01:00:00.000Z', turns: [{ role: 'user', text: 'second' }] });

  const res = mergeSessions(['m-2', 'm-1'], { title: 'Combined' });
  assert.equal(res.ok, true);
  assert.equal(res.merged.source, 'merged');
  assert.equal(res.merged.extracted.title, 'Combined');
  assert.equal(res.merged.startedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(res.merged.endedAt, '2026-01-02T01:00:00.000Z');
  assert.deepEqual(res.merged.mergedFrom, ['m-1', 'm-2']); // sorted by startedAt regardless of input order
  const userTexts = res.merged.turns.filter((t) => t.role === 'user').map((t) => t.text);
  assert.deepEqual(userTexts, ['first', 'second']);

  assert.deepEqual(loadRaw('m-1').supersededBy, [res.merged.id]);
  assert.deepEqual(loadRaw('m-2').supersededBy, [res.merged.id]);

  const un = unmerge(res.merged.id);
  assert.equal(un.ok, true);
  assert.equal(loadRaw(res.merged.id), null);
  assert.deepEqual(loadRaw('m-1').supersededBy, []);
  assert.deepEqual(loadRaw('m-2').supersededBy, []);
});

test('mergeSessions() propagates demo:true from originals so tutorial.js\'s endTutorial() sweep still catches the merge product', () => {
  seed('md-1', { demo: true });
  seed('md-2', { demo: true });
  const res = mergeSessions(['md-1', 'md-2']);
  assert.equal(res.ok, true);
  assert.equal(res.merged.demo, true);
});

test('mergeSessions() leaves demo unset when no original was a demo session', () => {
  seed('nd-1');
  seed('nd-2');
  const res = mergeSessions(['nd-1', 'nd-2']);
  assert.equal(res.ok, true);
  assert.ok(!res.merged.demo);
});

test('unmerge() rejects an id that was never a merge product', () => {
  seed('not-merged');
  const res = unmerge('not-merged');
  assert.equal(res.ok, false);
});

test('renameFolder() rewrites folder path prefix on every affected session and moves the directory', () => {
  mkdir('old/path');
  seed('rf-1', { folder: 'old/path' });
  seed('rf-2', { folder: 'old/path/nested' });
  seed('rf-3', { folder: 'unrelated' });

  const res = renameFolder('old/path', 'new/path');
  assert.equal(res.ok, true);
  assert.equal(loadRaw('rf-1').folder, 'new/path');
  assert.equal(loadRaw('rf-2').folder, 'new/path/nested');
  assert.equal(loadRaw('rf-3').folder, 'unrelated');
  assert.ok(existsSync(join(TREE_DIR, 'new', 'path')));
  assert.equal(existsSync(join(TREE_DIR, 'old', 'path')), false);
});

test('renameFolder() rejects renaming into itself or its own subtree', () => {
  mkdir('self/folder');
  assert.equal(renameFolder('self/folder', 'self/folder').ok, false);
  assert.equal(renameFolder('self/folder', 'self/folder/child').ok, false);
});

test('renameFolder() handles a case-only rename on this filesystem without data loss', () => {
  mkdir('CaseTest');
  seed('case-1', { folder: 'CaseTest' });
  const res = renameFolder('CaseTest', 'casetest');
  assert.equal(res.ok, true);
  assert.equal(loadRaw('case-1').folder, 'casetest');
  assert.ok(existsSync(join(TREE_DIR, 'casetest')));
});

test('deleteFolder() reassigns affected sessions (default to unfiled) and removes the directory', () => {
  mkdir('gone/sub');
  seed('df-1', { folder: 'gone' });
  seed('df-2', { folder: 'gone/sub' });
  seed('df-3', { folder: 'stays' });

  const res = deleteFolder('gone');
  assert.equal(res.ok, true);
  assert.equal(res.moved, 2);
  assert.equal(loadRaw('df-1').folder, null);
  assert.equal(loadRaw('df-2').folder, null);
  assert.equal(loadRaw('df-3').folder, 'stays');
  assert.equal(existsSync(join(TREE_DIR, 'gone')), false);
});

test('deleteFolder() can reassign to a specific folder instead of unfiling', () => {
  mkdir('gone2');
  seed('df-4', { folder: 'gone2' });
  deleteFolder('gone2', { reassignTo: 'landing' });
  assert.equal(loadRaw('df-4').folder, 'landing');
});

test('deleteFolder() on a missing path is a harmless no-op', () => {
  const res = deleteFolder('never/existed');
  assert.equal(res.ok, true);
  assert.equal(res.moved, 0);
});

// ---- Smart-organize classification workflow ----
// Every test below seeds sessions under its own unique folder and passes
// {folder: ...} to scope classificationCandidates()/summarizeCandidates()/
// suggestPlacements() — this file seeds many plain (organizedBy: 'auto')
// sessions in earlier tests that would otherwise leak into these unscoped
// LLM-workflow calls.

test('classificationCandidates() includes non-human sessions and excludes human-owned ones, scoped by folder', () => {
  seed('cc-auto', { folder: 'cc-scope', organizedBy: 'auto' });
  seed('cc-human', { folder: 'cc-scope' });
  move('cc-human', 'cc-scope'); // marks organizedBy: 'human'

  const ids = classificationCandidates({ folder: 'cc-scope' }).map((n) => n.id);
  assert.ok(ids.includes('cc-auto'));
  assert.equal(ids.includes('cc-human'), false);
});

test('classificationCandidates() cooldownMs excludes recently-classified sessions', () => {
  seed('cc-cooldown', { folder: 'cc-cooldown-scope', organizedBy: 'auto', lastClassifiedAt: new Date().toISOString() });

  const withCooldown = classificationCandidates({ folder: 'cc-cooldown-scope', cooldownMs: 24 * 60 * 60 * 1000 }).map((n) => n.id);
  assert.equal(withCooldown.includes('cc-cooldown'), false);

  const noCooldown = classificationCandidates({ folder: 'cc-cooldown-scope', cooldownMs: 0 }).map((n) => n.id);
  assert.ok(noCooldown.includes('cc-cooldown'));
});

test('summarizeCandidates() only targets candidates that lack a summary, scoped by folder', async () => {
  seed('sc-needs', { folder: 'sc-scope', organizedBy: 'auto', turns: [{ role: 'user', text: 'needs a summary' }] });
  seed('sc-has', { folder: 'sc-scope', organizedBy: 'auto', turns: [{ role: 'user', text: 'already summarized' }], extracted: { title: 'x', tags: [], summary: 'already there', decisions: [], todos: [] } });
  const seenIds = [];
  __setTestProvider(async (prompt) => {
    seenIds.push(prompt.includes('needs a summary') ? 'sc-needs' : 'sc-has');
    return JSON.stringify({ title: 'Generated', tags: ['t'], summary: 'generated summary', decisions: [], todos: [] });
  });

  const res = await summarizeCandidates({ folder: 'sc-scope' });

  assert.equal(res.done, 1);
  assert.deepEqual(seenIds, ['sc-needs']);
  assert.equal(loadRaw('sc-needs').extracted.summary, 'generated summary');
  assert.equal(loadRaw('sc-has').extracted.summary, 'already there');
});

test('suggestPlacements() matches a known folder and stamps lastClassifiedAt regardless of outcome', async () => {
  seed('sp-known', { folder: null, organizedBy: 'auto', extracted: { title: 'x', tags: [], summary: 'about backend auth work', decisions: [], todos: [] } });
  seed('sp-nomatch', { folder: null, organizedBy: 'auto', extracted: { title: 'x', tags: [], summary: 'about something totally unrelated', decisions: [], todos: [] } });
  __setTestProvider(async () =>
    JSON.stringify({
      placements: [
        { id: 'sp-known', folder: 'sp-existing-folder', reason: 'matches existing folder' },
        { id: 'sp-nomatch', folder: null, reason: 'no good fit' },
      ],
    }),
  );

  const res = await suggestPlacements({ folder: null });

  assert.equal(res.ok, true);
  const known = res.placements.find((p) => p.id === 'sp-known');
  const nomatch = res.placements.find((p) => p.id === 'sp-nomatch');
  assert.equal(known.folder, 'sp-existing-folder');
  assert.equal(nomatch.folder, null);
  // Both candidates were shown to the LLM this round, matched or not — the
  // cooldown depends on this being stamped regardless of outcome.
  assert.ok(loadRaw('sp-known').lastClassifiedAt);
  assert.ok(loadRaw('sp-nomatch').lastClassifiedAt);
});

test('suggestPlacements() rejects an unsafe proposed folder path (e.g. containing "..")', async () => {
  seed('sp-unsafe', { folder: null, organizedBy: 'auto', extracted: { title: 'x', tags: [], summary: 'some summary text', decisions: [], todos: [] } });
  __setTestProvider(async () => JSON.stringify({ placements: [{ id: 'sp-unsafe', folder: '../../etc', reason: 'sneaky' }] }));

  const res = await suggestPlacements({ folder: null });

  const p = res.placements.find((x) => x.id === 'sp-unsafe');
  assert.equal(p.folder, null);
});

test('suggestPlacements() returns no-op immediately with no LLM call when there are no summarized candidates', async () => {
  let called = false;
  __setTestProvider(async () => {
    called = true;
    return JSON.stringify({ placements: [] });
  });
  const res = await suggestPlacements({ folder: 'sp-truly-empty-scope' });
  assert.equal(res.ok, true);
  assert.deepEqual(res.placements, []);
  assert.equal(called, false);
});

test('suggestPlacements() runs multiple chunks concurrently (bounded by concurrency)', async () => {
  for (let i = 0; i < 6; i++) {
    seed(`sp-conc-${i}`, { folder: null, organizedBy: 'auto', extracted: { title: 'x', tags: [], summary: `summary ${i}`, decisions: [], todos: [] } });
  }
  let inFlight = 0;
  let maxInFlight = 0;
  __setTestProvider(async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 10));
    inFlight--;
    return JSON.stringify({ placements: [] });
  });

  // batchSize:1 -> 6 candidates matching "sp-conc-" become 6 chunks; scope
  // via folder:null keeps this to just the sessions this test seeded.
  const res = await suggestPlacements({ folder: null, batchSize: 1, concurrency: 3 });

  assert.equal(res.ok, true);
  assert.ok(maxInFlight >= 2, `expected real concurrency (>=2), saw ${maxInFlight}`);
  assert.ok(maxInFlight <= 3, `expected at most concurrency=3, saw ${maxInFlight}`);
  for (let i = 0; i < 6; i++) assert.ok(loadRaw(`sp-conc-${i}`).lastClassifiedAt);
});

test('suggestPlacements() surfaces a chunk failure but still finishes/stamps chunks that were already in flight', async () => {
  seed('sp-fail-a', { folder: null, organizedBy: 'auto', extracted: { title: 'x', tags: [], summary: 'fail-a summary', decisions: [], todos: [] } });
  seed('sp-fail-b', { folder: null, organizedBy: 'auto', extracted: { title: 'x', tags: [], summary: 'fail-b summary', decisions: [], todos: [] } });
  __setTestProvider(async (prompt) => {
    if (prompt.includes('fail-a summary')) throw new Error('llm down for this chunk');
    return JSON.stringify({ placements: [] });
  });

  const res = await suggestPlacements({ folder: null, batchSize: 1, concurrency: 2 });

  assert.equal(res.ok, false);
  assert.match(res.error, /llm down for this chunk/);
  // The other chunk was already in flight concurrently — its work isn't
  // thrown away just because a sibling chunk failed.
  assert.ok(loadRaw('sp-fail-b').lastClassifiedAt);
});

test('queueSuggestions()/pendingSuggestions()/clearSuggestions() round-trip without any LLM involvement', () => {
  seed('qs-1', { folder: null, organizedBy: 'auto' });

  const queued = queueSuggestions([{ id: 'qs-1', folder: 'qs-target', reason: 'looks related' }]);
  assert.equal(queued, 1);

  const pending = pendingSuggestions({ folder: null });
  const mine = pending.find((p) => p.id === 'qs-1');
  assert.equal(mine.folder, 'qs-target');
  assert.equal(mine.reason, 'looks related');

  clearSuggestions(['qs-1']);
  assert.equal(loadRaw('qs-1').suggestedFolder, null);
  assert.equal(
    pendingSuggestions({ folder: null }).some((p) => p.id === 'qs-1'),
    false,
  );
});

test('applyPlacements() moves each placement with a folder (via move()) and skips null-folder ones', () => {
  seed('ap-1', { folder: null, organizedBy: 'auto' });
  seed('ap-2', { folder: null, organizedBy: 'auto' });

  const applied = applyPlacements([
    { id: 'ap-1', folder: 'ap-target' },
    { id: 'ap-2', folder: null },
  ]);

  assert.equal(applied, 1);
  assert.equal(loadRaw('ap-1').folder, 'ap-target');
  assert.equal(loadRaw('ap-1').organizedBy, 'human');
  assert.equal(loadRaw('ap-2').folder, null);
});
