import test from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers.js';

useTempHome();

const { emptyNeutral } = await import('../src/schema.js');
const { saveRaw } = await import('../src/scanner.js');
const { __setTestProvider, __clearTestProvider } = await import('../src/llm.js');
const { digestCycle, proposeKnowledgeRefreshes } = await import('../src/daemon/cycles.js');
const { pendingKnowledgeReviews } = await import('../src/insight.js');

function seed(id, overrides = {}) {
  const n = { ...emptyNeutral(id, 'claude'), ...overrides };
  saveRaw(n);
  return n;
}

function fakeLog() {
  const lines = [];
  return { log: (l) => lines.push(l), error: (l) => lines.push(l), lines };
}

test.afterEach(() => __clearTestProvider());

test('proposeKnowledgeRefreshes() stages a KNOWLEDGE.pending.md for every filed folder active on that date', async () => {
  seed('pkr-1', { folder: 'pkr-folder-a', startedAt: '2026-07-01T09:00:00.000Z', extracted: { title: null, tags: [], summary: 'thing a', decisions: [], todos: [] } });
  seed('pkr-2', { folder: 'pkr-folder-b', startedAt: '2026-07-01T09:00:00.000Z', extracted: { title: null, tags: [], summary: 'thing b', decisions: [], todos: [] } });
  __setTestProvider(async () => 'generated knowledge text');

  await proposeKnowledgeRefreshes('2026-07-01', fakeLog());

  const reviews = pendingKnowledgeReviews();
  assert.ok(reviews.some((r) => r.folder === 'pkr-folder-a'));
  assert.ok(reviews.some((r) => r.folder === 'pkr-folder-b'));
});

test('proposeKnowledgeRefreshes() skips a folder that already has an unreviewed pending proposal — no duplicate LLM call', async () => {
  seed('pkr-skip-1', { folder: 'pkr-skip-folder', startedAt: '2026-07-02T09:00:00.000Z' });
  let calls = 0;
  __setTestProvider(async () => {
    calls++;
    return 'first proposal';
  });
  await proposeKnowledgeRefreshes('2026-07-02', fakeLog());
  assert.equal(calls, 1);

  // Same folder, same (or later) active date — already has a pending file.
  await proposeKnowledgeRefreshes('2026-07-02', fakeLog());
  assert.equal(calls, 1, 'no second LLM call for a folder still awaiting review');
});

test('proposeKnowledgeRefreshes() is a no-op (no LLM call) when no folder was active that date', async () => {
  let called = false;
  __setTestProvider(async () => {
    called = true;
    return 'x';
  });
  await proposeKnowledgeRefreshes('2020-01-01', fakeLog());
  assert.equal(called, false);
});

test('proposeKnowledgeRefreshes() logs failures per folder without throwing', async () => {
  seed('pkr-fail-1', { folder: 'pkr-fail-folder', startedAt: '2026-07-03T09:00:00.000Z' });
  __setTestProvider(async () => {
    throw new Error('llm boom');
  });
  const log = fakeLog();
  await proposeKnowledgeRefreshes('2026-07-03', log);
  assert.ok(log.lines.some((l) => /llm boom/.test(l)));
  assert.equal(pendingKnowledgeReviews().some((r) => r.folder === 'pkr-fail-folder'), false);
});

test('digestCycle() generates the digest and proposes knowledge refreshes for yesterday\'s active folders, on its first run', async () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  seed('dc-1', { folder: 'dc-folder', startedAt: `${yesterday}T09:00:00.000Z`, extracted: { title: null, tags: [], summary: 'dc summary', decisions: [], todos: [] } });
  __setTestProvider(async () => 'dc knowledge');

  await digestCycle(fakeLog());

  assert.ok(pendingKnowledgeReviews().some((r) => r.folder === 'dc-folder'));
});
