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
const { digestCycle, knowledgeReviewCycle, runDaemon } = await import('../src/daemon/cycles.js');
const { pendingKnowledgeReviews } = await import('../src/insight.js');
const adaptersIndex = await import('../src/adapters/index.js');

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

test('runDaemon() fires onFirstScanDone once, right after the first scan — before it schedules any periodic interval', async (t) => {
  // Mocked, not real: runDaemon() ends by registering several real
  // setInterval()s (SCAN_INTERVAL_MS etc.) that would otherwise keep
  // ticking for the rest of this test file's process — mock timers replace
  // them with an inert fake clock this test never advances, so nothing
  // real gets scheduled and the process exits normally once this test ends.
  t.mock.timers.enable({ apis: ['setInterval'] });
  // No fake adapters needed — an empty ADAPTERS list makes scan() a fast,
  // deterministic no-op (0 scanned/imported), same effect as
  // scanner.test.js's withOnlyAdapters() but inline since this is the only
  // adapter-splicing test in this file.
  const real = adaptersIndex.ADAPTERS.splice(0, adaptersIndex.ADAPTERS.length);
  // This file's shared temp store (see AGENTS.md) still has the earlier
  // tests' seeded sessions in it — smartOrganizeCycle() (unlike digest/
  // knowledge review, already gated to once/day and skipped by the time
  // this test runs) hasn't fired yet in this process, so it sees those as
  // real unclassified candidates and would otherwise spawn a REAL
  // claude/codex subprocess here. Any parseable-but-empty reply is enough
  // — this test only cares about onFirstScanDone's timing, not what
  // smartOrganizeCycle does with it.
  __setTestProvider(async () => '{}');
  let fired = 0;
  try {
    await runDaemon({ log: fakeLog(), onFirstScanDone: () => fired++ });
  } finally {
    adaptersIndex.ADAPTERS.splice(0, adaptersIndex.ADAPTERS.length, ...real);
  }

  assert.equal(fired, 1, 'fires exactly once for the whole runDaemon() call, not per later cycle');
});

test('runDaemon() fires onFirstScanDone right after scan()+reindex(), before the slower tagAll() pass resolves', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  // A real bug: an earlier version fired this hook only after the WHOLE
  // scanCycle() (including tagAll()'s real, potentially slow LLM calls)
  // resolved — a caller wanting to refresh a just-mounted view (see
  // tui/index.js) needs to know as soon as data is queryable, not after
  // however long tagging a real backlog takes. Proven here by gating the
  // test LLM provider on a promise this test controls: if onFirstScanDone
  // fired before tagAll()'s own call resolves, the fix is doing its job.
  const fakeRef = { id: 'onscanned-1', mtimeMs: 1000 };
  const fakeAdapter = {
    name: 'fake-source',
    listSessions: () => [fakeRef],
    parse: (ref) => {
      const n = emptyNeutral(ref.id, 'fake-source');
      n.turns = [{ role: 'user', text: 'do the thing' }];
      return n;
    },
  };
  const real = adaptersIndex.ADAPTERS.splice(0, adaptersIndex.ADAPTERS.length, fakeAdapter);
  let resolveLLM;
  const llmGate = new Promise((r) => (resolveLLM = r));
  __setTestProvider(() => llmGate); // tagAll()'s complete() call hangs here until resolved below
  let firedWhileLLMPending = false;
  try {
    const daemonPromise = runDaemon({
      log: fakeLog(),
      onFirstScanDone: () => {
        firedWhileLLMPending = true;
      },
    });
    // The LLM call is still gated on llmGate at this point — if the hook
    // already fired, it fired strictly before tagAll()'s own await settled.
    assert.equal(firedWhileLLMPending, true, 'onScanned already fired while tagAll()\'s LLM call is still pending');
    resolveLLM(JSON.stringify({ title: 'x', tags: [], summary: 'onscanned test summary', decisions: [], todos: [] }));
    await daemonPromise;
  } finally {
    adaptersIndex.ADAPTERS.splice(0, adaptersIndex.ADAPTERS.length, ...real);
  }
});
