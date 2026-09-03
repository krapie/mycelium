import test from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers.js';

useTempHome();

const { createBacklog, listBacklog, markBacklogEntered, buildBacklogSeed, isBacklogReplaced } = await import('../src/backlog.js');
const { isBacklog } = await import('../src/schema.js');
const { loadRaw, saveRaw } = await import('../src/scanner.js');
const { emptyNeutral } = await import('../src/schema.js');
const { autoTagSession, tagAll } = await import('../src/learn.js');
const { suggestSplitBoundaries } = await import('../src/split.js');
const { mergeSessions, linkContinuation } = await import('../src/organize.js');
const { sessionsForPeriod } = await import('../src/insight.js');
const { reindex, listSessions, search } = await import('../src/index-db.js');
const { scan } = await import('../src/scanner.js');
const adaptersIndex = await import('../src/adapters/index.js');
const { __setTestProvider, __clearTestProvider } = await import('../src/llm.js');

test.afterEach(() => __clearTestProvider());

test('createBacklog() stores a human-owned, transcript-less session carrying the title and description', () => {
  const res = createBacklog({ title: 'Add the backlog feature', description: 'see issue #113', folder: 'Projects/mycelium' });
  assert.equal(res.ok, true);
  const n = loadRaw(res.session.id);
  assert.equal(isBacklog(n), true);
  assert.equal(n.source, null);
  assert.deepEqual(n.turns, []);
  assert.equal(n.extracted.title, 'Add the backlog feature');
  assert.equal(n.extracted.summary, 'see issue #113');
  assert.equal(n.folder, 'Projects/mycelium');
  // A person wrote this deliberately — the same stickiness a manual move gets,
  // which is also what keeps scanner.js's auto-archive sweep off it.
  assert.equal(n.organizedBy, 'human');
  assert.equal(n.titleLocked, true);
  assert.equal(n.doneAt, null);
});

test('createBacklog() refuses an empty title', () => {
  assert.equal(createBacklog({ title: '   ', description: 'x' }).ok, false);
});

test('listBacklog() scopes by folder the same three ways listSessions() does, and hides only replaced items', () => {
  const a = createBacklog({ title: 'filed', folder: 'Work/api' }).session;
  const b = createBacklog({ title: 'unfiled' }).session;

  assert.deepEqual(listBacklog({ folder: 'Work' }).map((n) => n.id), [a.id]);
  assert.deepEqual(listBacklog({ folder: null }).map((n) => n.id), [b.id]);
  assert.equal(listBacklog({ folder: undefined }).length >= 2, true);

  // Started but nothing came of it yet: still the only record of that intent,
  // so it stays listed (its row just carries the "started" mark).
  markBacklogEntered(a.id);
  assert.deepEqual(listBacklog({ folder: 'Work' }).map((n) => n.id), [a.id]);

  // Replaced by a real session — that row stands in for it now.
  saveRaw({ ...emptyNeutral('work-child', 'claude'), turns: [{ role: 'user', text: 'on it' }] });
  linkContinuation('work-child', a.id);
  assert.equal(listBacklog({ folder: 'Work' }).length, 0);
  assert.deepEqual(listBacklog({ folder: 'Work', includeReplaced: true }).map((n) => n.id), [a.id]);
});

test('buildBacklogSeed() composes the prompt from the CURRENT title/description, in both locales', () => {
  const { id } = createBacklog({ title: 'Port the CLI', description: 'start from src/cli.js' }).session;

  const en = buildBacklogSeed(id, 'en');
  assert.equal(en.ok, true);
  assert.match(en.prompt, /Port the CLI/);
  assert.match(en.prompt, /start from src\/cli\.js/);
  assert.match(en.prompt, /No work has been done on it yet/);

  const ko = buildBacklogSeed(id, 'ko');
  assert.match(ko.prompt, /Port the CLI/);
  assert.match(ko.prompt, /아직 진행된 작업은 없습니다/);

  // Edited after the fact — the seed is composed at open time, never stored
  // alongside the fields, so it can't go stale.
  const n = loadRaw(id);
  n.extracted.summary = 'actually, start from src/agents.js';
  saveRaw(n);
  assert.match(buildBacklogSeed(id, 'en').prompt, /src\/agents\.js/);
});

test('buildBacklogSeed() refuses anything that is not a backlog item', () => {
  saveRaw({ ...emptyNeutral('real-1', 'claude'), turns: [{ role: 'user', text: 'hi' }] });
  assert.equal(buildBacklogSeed('real-1').ok, false);
  assert.equal(buildBacklogSeed('nope').ok, false);
});

test('the transcript-shaped paths refuse a backlog item instead of treating it as an empty session', async () => {
  const { id } = createBacklog({ title: 'nothing to summarize' }).session;

  const tagged = await autoTagSession(id);
  assert.equal(tagged.ok, false);
  assert.match(tagged.error, /backlog/);

  const split = await suggestSplitBoundaries(id);
  assert.equal(split.ok, false);

  saveRaw({ ...emptyNeutral('real-2', 'claude'), turns: [{ role: 'user', text: 'hi' }] });
  assert.equal(mergeSessions([id, 'real-2']).ok, false);
});

test('tagAll() skips backlog items rather than spending a failure on each', async () => {
  const { id } = createBacklog({ title: 'never auto-tagged' }).session;
  const before = loadRaw(id).extracted.title;
  // The other sessions this file seeds are ordinary ones tagAll() will happily
  // summarize — without a provider they'd each spawn a real agent CLI.
  __setTestProvider(async () => JSON.stringify({ title: 'A Title', tags: [], summary: 'a summary', decisions: [], todos: [] }));
  const res = await tagAll();
  assert.equal(res.failed, 0);
  assert.equal(loadRaw(id).extracted.title, before);
});

test('digests/knowledge treat a backlog item as intent, not as activity in the period', () => {
  const { id, startedAt } = createBacklog({ title: 'queued today', folder: 'Work' }).session;
  const day = startedAt.slice(0, 10);
  assert.equal(sessionsForPeriod('day', day).some((s) => s.id === id), false);
});

test('a backlog item is listed and searchable by title, and drops out once a real session links back to it', () => {
  const { id } = createBacklog({ title: 'unique-backlog-phrase', description: 'notes here', folder: 'Later' }).session;
  reindex();

  const listed = listSessions({ folder: 'Later' });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].kind, 'backlog');
  assert.equal(listed[0].done_at, null);
  assert.equal(search({ query: 'unique-backlog-phrase' }).length, 1);

  // Entered, but nothing captured yet (the "copy command" path) — the note
  // must stay visible, otherwise it's simply lost.
  markBacklogEntered(id);
  reindex();
  assert.equal(listSessions({ folder: 'Later' }).length, 1);
  assert.equal(isBacklogReplaced(loadRaw(id)), false);

  // A real session came back and was linked as its continuation: that row now
  // stands in for the note, the same way a merge product hides its originals.
  saveRaw({ ...emptyNeutral('child-1', 'claude'), folder: 'Later', turns: [{ role: 'user', text: 'working on it' }] });
  linkContinuation('child-1', id);
  reindex();
  const after = listSessions({ folder: 'Later' });
  assert.deepEqual(after.map((r) => r.id), ['child-1']);
  assert.equal(isBacklogReplaced(loadRaw(id)), true);
});

// scan() reads the REAL agent stores by design (adapters/index.js), so a test
// that needs a deterministic import splices the registry down to a fake one,
// same pattern as test/scanner.test.js's withOnlyAdapters().
function withOnlyAdapters(fakeAdapters, fn) {
  const real = adaptersIndex.ADAPTERS.splice(0, adaptersIndex.ADAPTERS.length, ...fakeAdapters);
  try {
    return fn();
  } finally {
    adaptersIndex.ADAPTERS.splice(0, adaptersIndex.ADAPTERS.length, ...real);
  }
}

function fakeAdapterFor(id, text) {
  return {
    name: 'claude',
    listSessions: () => [{ id, path: `/fake/${id}.jsonl`, mtimeMs: 1 }],
    parse: () => {
      const n = emptyNeutral(id, 'claude');
      n.startedAt = new Date().toISOString();
      n.endedAt = n.startedAt;
      n.turns = [{ role: 'user', text }];
      return n;
    },
  };
}

test('a session started from the COPIED command is adopted by its item on first import', () => {
  const item = createBacklog({ title: 'pasted into another tab', description: 'notes', folder: 'Work/api' }).session;
  const seed = buildBacklogSeed(item.id, 'en').prompt;
  assert.match(seed, /mycelium:backlog:/, 'the seed carries the marker that makes this possible');

  const res = withOnlyAdapters([fakeAdapterFor('pasted-1', seed)], () => scan());
  assert.deepEqual(res.adoptedParents, [item.id], 'scan reports the item whose row it just changed');

  const child = loadRaw('pasted-1');
  assert.equal(child.continuationOf, item.id);
  assert.equal(child.folder, 'Work/api', "an unfiled child of a filed note inherits the note's folder");

  const parent = loadRaw(item.id);
  assert.deepEqual(parent.continuedTo, ['pasted-1']);
  assert.ok(parent.doneAt, 'a command pasted days later still marks the item started');
  assert.equal(isBacklogReplaced(parent), true);
});

test('adoption ignores a marker that names something which is not a backlog item', () => {
  // 8+ chars, or backlogSeedId() wouldn't even parse the marker and this would
  // pass without ever reaching the isBacklog() check it exists to cover.
  saveRaw({ ...emptyNeutral('real-333', 'claude'), turns: [{ role: 'user', text: 'hi' }] });
  const text = `do the thing\n\n<!-- mycelium:backlog:real-333 -->`;
  withOnlyAdapters([fakeAdapterFor('pasted-2', text)], () => scan());
  assert.equal(loadRaw('pasted-2').continuationOf, null);
});
