import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers.js';

useTempHome();

const { emptyNeutral } = await import('../src/schema.js');
const { saveRaw } = await import('../src/scanner.js');
const { __setTestProvider, __clearTestProvider } = await import('../src/llm.js');
const { DIGEST_DIR } = await import('../src/paths.js');
const { digestCycle, knowledgeReviewCycle } = await import('../src/daemon/cycles.js');
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

// Each cycle function gates itself to once per real local calendar day (see
// their own lastDigestDay/lastKnowledgeReviewDay module-level state) — that
// makes driving either through more than one scenario within this single
// test file impractical (node:test runs one process per file, so the gate
// persists across every test here). Detailed per-folder scenario coverage
// (skip-if-pending, limit, failure handling) lives in insight.test.js
// against proposeKnowledgeRefreshes() directly, which has no such gate —
// this file only proves each cycle's own first-run orchestration and that
// the two are genuinely independent of each other.

test('digestCycle() generates yesterday\'s digest, on its first run — and nothing else (independent of knowledge review)', async () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  seed('dc-1', { folder: 'dc-folder', startedAt: `${yesterday}T09:00:00.000Z`, extracted: { title: null, tags: [], summary: 'dc summary', decisions: [], todos: [] } });
  __setTestProvider(async () => 'dc narrative');

  await digestCycle(fakeLog());

  assert.ok(existsSync(join(DIGEST_DIR, `${yesterday}.md`)));
  assert.equal(pendingKnowledgeReviews().length, 0, 'digestCycle no longer stages any knowledge proposal — reverted, separate feature');
});

test('knowledgeReviewCycle() stages a proposal for yesterday\'s active folders, on its first run — fully independent of Digest', async () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  seed('krc-1', { folder: 'krc-folder', startedAt: `${yesterday}T09:00:00.000Z`, extracted: { title: null, tags: [], summary: 'krc summary', decisions: [], todos: [] } });
  __setTestProvider(async () => 'krc knowledge text');

  // No digestCycle() call in this test at all — proves knowledgeReviewCycle
  // doesn't depend on a digest having been generated first.
  await knowledgeReviewCycle(fakeLog());

  const reviews = pendingKnowledgeReviews();
  assert.ok(reviews.some((r) => r.folder === 'krc-folder'));
});
