import test from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers.js';

useTempHome();

const { emptyNeutral } = await import('../src/schema.js');
const { saveRaw } = await import('../src/scanner.js');
const { reindex, listSessions, search, folderCounts, sessionCountsByDay, listTags } = await import('../src/index-db.js');

function seed(id, overrides = {}) {
  const n = { ...emptyNeutral(id, 'claude'), ...overrides };
  saveRaw(n);
  return n;
}

test('listSessions() three-way folder scope: undefined=all, null=unfiled only, string=subtree', () => {
  seed('ls-1', { folder: null, startedAt: '2026-01-01T00:00:00.000Z' });
  seed('ls-2', { folder: 'work', startedAt: '2026-01-02T00:00:00.000Z' });
  seed('ls-3', { folder: 'work/sub', startedAt: '2026-01-03T00:00:00.000Z' });
  seed('ls-4', { folder: 'other', startedAt: '2026-01-04T00:00:00.000Z' });
  reindex();

  const all = listSessions({});
  assert.equal(all.length, 4);

  const unfiled = listSessions({ folder: null });
  assert.deepEqual(unfiled.map((r) => r.id), ['ls-1']);

  const subtree = listSessions({ folder: 'work' })
    .map((r) => r.id)
    .sort();
  assert.deepEqual(subtree, ['ls-2', 'ls-3']);
});

test('listSessions() orders by started_at DESC', () => {
  seed('ord-1', { startedAt: '2026-01-01T00:00:00.000Z' });
  seed('ord-2', { startedAt: '2026-01-03T00:00:00.000Z' });
  seed('ord-3', { startedAt: '2026-01-02T00:00:00.000Z' });
  reindex();
  const ids = listSessions({}).map((r) => r.id);
  const idx = (id) => ids.indexOf(id);
  assert.ok(idx('ord-2') < idx('ord-3'));
  assert.ok(idx('ord-3') < idx('ord-1'));
});

test('listSessions() hides _archive by default but includes it when explicitly browsed', () => {
  seed('arch-1', { folder: '_archive' });
  reindex();
  assert.equal(
    listSessions({}).some((r) => r.id === 'arch-1'),
    false,
  );
  assert.ok(listSessions({ folder: '_archive' }).some((r) => r.id === 'arch-1'));
});

test('listSessions() hides superseded sessions unless includeSuperseded is true', () => {
  seed('sup-1', { supersededBy: ['other-id'] });
  reindex();
  assert.equal(
    listSessions({}).some((r) => r.id === 'sup-1'),
    false,
  );
  assert.ok(listSessions({ includeSuperseded: true }).some((r) => r.id === 'sup-1'));
});

test('listSessions() date filter matches ended_at, falling back to started_at', () => {
  seed('date-1', { startedAt: '2026-02-01T00:00:00.000Z', endedAt: '2026-02-05T00:00:00.000Z' });
  seed('date-2', { startedAt: '2026-02-01T00:00:00.000Z', endedAt: null });
  reindex();
  const onEndDay = listSessions({ date: '2026-02-05' }).map((r) => r.id);
  assert.deepEqual(onEndDay, ['date-1']);
  const onStartDayNoEnd = listSessions({ date: '2026-02-01' }).map((r) => r.id);
  assert.deepEqual(onStartDayNoEnd, ['date-2']);
});

test('search() with a text query ranks by bm25 relevance, not just recency', () => {
  seed('srch-1', { startedAt: '2026-01-01T00:00:00.000Z', turns: [{ role: 'user', text: 'irrelevant unrelated content' }] });
  seed('srch-2', {
    startedAt: '2026-01-05T00:00:00.000Z',
    turns: [{ role: 'user', text: 'fix the authentication bug in login flow, authentication authentication' }],
  });
  reindex();
  const results = search({ query: 'authentication' });
  assert.ok(results.length >= 1);
  assert.equal(results[0].id, 'srch-2');
});

test('search() tag filter is AND across multiple tags', () => {
  seed('tag-a', { extracted: { title: null, tags: ['backend', 'bug'], summary: null, decisions: [], todos: [] } });
  seed('tag-b', { extracted: { title: null, tags: ['backend'], summary: null, decisions: [], todos: [] } });
  reindex();
  const both = search({ tags: ['backend', 'bug'] }).map((r) => r.id);
  assert.deepEqual(both, ['tag-a']);
  const justBackend = search({ tags: ['backend'] })
    .map((r) => r.id)
    .sort();
  assert.deepEqual(justBackend, ['tag-a', 'tag-b']);
});

test('search() query tokens survive punctuation and are safely quoted for FTS5', () => {
  seed('punct-1', { turns: [{ role: 'user', text: 'handling C++ and reading config.json carefully' }] });
  reindex();
  assert.doesNotThrow(() => search({ query: 'C++ config.json' }));
});

test('search() folder scope matches listSessions() semantics', () => {
  seed('sf-1', { folder: null });
  seed('sf-2', { folder: 'proj' });
  reindex();
  // Other tests in this file seed their own unfiled (folder: null) sessions
  // against the same shared temp store — assert sf-1 is included among the
  // unfiled results rather than assuming it's the only one.
  assert.ok(search({ folder: null }).some((r) => r.id === 'sf-1'));
  assert.deepEqual(
    search({ folder: 'proj' }).map((r) => r.id),
    ['sf-2'],
  );
});

test('folderCounts() counts sessions per folder, excluding superseded ones', () => {
  seed('fc-1', { folder: 'a' });
  seed('fc-2', { folder: 'a' });
  seed('fc-3', { folder: 'b' });
  seed('fc-4', { folder: 'a', supersededBy: ['x'] });
  reindex();
  const counts = Object.fromEntries(folderCounts().map((r) => [r.folder, r.n]));
  assert.equal(counts['a'], 2);
  assert.equal(counts['b'], 1);
});

test('sessionCountsByDay() groups by day-of-month for the given YYYY-MM, matching folderCounts() supersede exclusion', () => {
  seed('day-1', { startedAt: '2026-03-10T00:00:00.000Z', endedAt: '2026-03-10T00:00:00.000Z', folder: 'a' });
  seed('day-2', { startedAt: '2026-03-10T00:00:00.000Z', endedAt: '2026-03-10T00:00:00.000Z', folder: 'a' });
  seed('day-3', { startedAt: '2026-03-15T00:00:00.000Z', endedAt: '2026-03-15T00:00:00.000Z', folder: 'b' });
  seed('day-4', { startedAt: '2026-04-01T00:00:00.000Z', endedAt: '2026-04-01T00:00:00.000Z', folder: 'a' }); // different month
  reindex();
  const rows = sessionCountsByDay('2026-03');
  const day10 = rows.filter((r) => r.day === 10);
  assert.equal(day10.reduce((a, r) => a + r.n, 0), 2);
  const day15 = rows.filter((r) => r.day === 15);
  assert.equal(day15.reduce((a, r) => a + r.n, 0), 1);
  assert.equal(rows.some((r) => r.day === 1 && r.folder === 'a'), false); // April session excluded
});

test('listTags() returns tag names with usage counts, most-used first', () => {
  seed('lt-1', { extracted: { title: null, tags: ['popular'], summary: null, decisions: [], todos: [] } });
  seed('lt-2', { extracted: { title: null, tags: ['popular'], summary: null, decisions: [], todos: [] } });
  seed('lt-3', { extracted: { title: null, tags: ['rare'], summary: null, decisions: [], todos: [] } });
  reindex();
  const tags = listTags();
  const popular = tags.find((t) => t.name === 'popular');
  const rare = tags.find((t) => t.name === 'rare');
  assert.equal(popular.n, 2);
  assert.equal(rare.n, 1);
  assert.ok(tags.indexOf(popular) < tags.indexOf(rare));
});
