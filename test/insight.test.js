import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers.js';

useTempHome();

const { emptyNeutral } = await import('../src/schema.js');
const { saveRaw } = await import('../src/scanner.js');
const { __setTestProvider, __clearTestProvider } = await import('../src/llm.js');
const { DIGEST_DIR, TREE_DIR } = await import('../src/paths.js');
const {
  generateDigest,
  buildKnowledgeText,
  writeKnowledgeText,
  extractKnowledge,
  foldersWithSessions,
  foldersActiveOn,
  writePendingKnowledgeText,
  pendingKnowledgeReviews,
  promoteKnowledge,
  dismissPendingKnowledge,
} = await import('../src/insight.js');

function seed(id, overrides = {}) {
  const n = { ...emptyNeutral(id, 'claude'), ...overrides };
  saveRaw(n);
  return n;
}

test.afterEach(() => __clearTestProvider());

test('generateDigest() fails before calling the LLM when there are no sessions for the period', async () => {
  let called = false;
  __setTestProvider(async () => {
    called = true;
    return 'narrative';
  });
  const res = await generateDigest({ period: 'day', date: '2020-06-15' }); // a day nothing was seeded on
  assert.equal(res.ok, false);
  assert.match(res.error, /no sessions/);
  assert.equal(called, false);
});

test('generateDigest({period:"day"}) groups by exact day and writes DIGEST_DIR/<date>.md', async () => {
  seed('dig-day-1', { startedAt: '2026-03-10T09:00:00.000Z', folder: 'work', extracted: { title: null, tags: [], summary: 'did thing A', decisions: [], todos: [] } });
  __setTestProvider(async () => 'a narrative summary of the day');

  const res = await generateDigest({ period: 'day', date: '2026-03-10' });

  assert.equal(res.ok, true);
  assert.equal(res.keyed, '2026-03-10');
  assert.equal(res.count, 1);
  const path = join(DIGEST_DIR, '2026-03-10.md');
  assert.ok(existsSync(path));
  const content = readFileSync(path, 'utf8');
  assert.match(content, /a narrative summary of the day/);
  assert.match(content, /did thing A/);
});

test('generateDigest() falls back to the first REAL user turn (skipping synthetic ones) when a session has no summary', async () => {
  seed('dig-synthetic', {
    startedAt: '2026-05-01T09:00:00.000Z',
    folder: 'work',
    turns: [
      { role: 'user', text: '<bash-input>ignore me</bash-input>' },
      { role: 'user', text: 'the real digest fallback text' },
    ],
    extracted: { title: null, tags: [], summary: null, decisions: [], todos: [] },
  });
  let seenPrompt = '';
  __setTestProvider(async (prompt) => {
    seenPrompt = prompt;
    return 'narrative';
  });

  await generateDigest({ period: 'day', date: '2026-05-01' });

  assert.match(seenPrompt, /the real digest fallback text/);
  assert.doesNotMatch(seenPrompt, /bash-input/);
});

test('generateDigest({period:"week"}) groups by ISO week', async () => {
  // 2026-03-11 is a Wednesday in ISO week 2026-W11.
  seed('dig-week-1', { startedAt: '2026-03-09T09:00:00.000Z', folder: 'work' }); // Monday, same ISO week
  seed('dig-week-2', { startedAt: '2026-03-13T09:00:00.000Z', folder: 'work' }); // Friday, same ISO week
  __setTestProvider(async () => 'weekly narrative');

  const res = await generateDigest({ period: 'week', date: '2026-03-11' });

  assert.equal(res.ok, true);
  assert.equal(res.keyed, '2026-W11');
  // >= 2, not ===: the previous test's 2026-03-10 session falls in the same
  // ISO week and is picked up too, since this shares the store.
  assert.ok(res.count >= 2);
  assert.ok(existsSync(join(DIGEST_DIR, '2026-W11.md')));
});

test('generateDigest() reports a clean error when the LLM call fails', async () => {
  seed('dig-fail-1', { startedAt: '2026-04-01T09:00:00.000Z' });
  __setTestProvider(async () => {
    throw new Error('boom');
  });
  const res = await generateDigest({ period: 'day', date: '2026-04-01' });
  assert.equal(res.ok, false);
  assert.match(res.error, /boom/);
});

test('buildKnowledgeText() fails with no LLM call when the folder has no sessions', async () => {
  let called = false;
  __setTestProvider(async () => {
    called = true;
    return 'knowledge';
  });
  const res = await buildKnowledgeText('nonexistent/folder/xyz');
  assert.equal(res.ok, false);
  assert.equal(called, false);
});

test('buildKnowledgeText() excludes superseded sessions from the material sent to the LLM', async () => {
  seed('know-visible', { folder: 'kf', extracted: { title: null, tags: [], summary: 'visible summary text', decisions: [], todos: [] } });
  seed('know-hidden', { folder: 'kf', supersededBy: ['other'], extracted: { title: null, tags: [], summary: 'HIDDEN summary text', decisions: [], todos: [] } });
  let seenPrompt = '';
  __setTestProvider(async (prompt) => {
    seenPrompt = prompt;
    return 'compiled knowledge';
  });

  const res = await buildKnowledgeText('kf');

  assert.equal(res.ok, true);
  assert.equal(res.count, 1);
  assert.match(seenPrompt, /visible summary text/);
  assert.doesNotMatch(seenPrompt, /HIDDEN summary text/);
});

test('buildKnowledgeText() generates without writing; writeKnowledgeText() writes separately', async () => {
  seed('know-split', { folder: 'split-folder', extracted: { title: null, tags: [], summary: 'some summary', decisions: [], todos: [] } });
  __setTestProvider(async () => 'the generated knowledge');

  const gen = await buildKnowledgeText('split-folder');
  assert.equal(gen.ok, true);
  const kPath = join(TREE_DIR, 'split-folder', 'KNOWLEDGE.md');
  assert.equal(existsSync(kPath), false); // not written yet

  const written = writeKnowledgeText('split-folder', gen.text);
  assert.equal(written.ok, true);
  assert.ok(existsSync(kPath));
  assert.match(readFileSync(kPath, 'utf8'), /the generated knowledge/);
});

test('extractKnowledge() generates AND writes in one call', async () => {
  seed('know-combined', { folder: 'combined-folder', extracted: { title: null, tags: [], summary: 'combined summary', decisions: [], todos: [] } });
  __setTestProvider(async () => 'combined knowledge text');

  const res = await extractKnowledge('combined-folder');

  assert.equal(res.ok, true);
  const kPath = join(TREE_DIR, 'combined-folder', 'KNOWLEDGE.md');
  assert.ok(existsSync(kPath));
  assert.match(readFileSync(kPath, 'utf8'), /combined knowledge text/);
});

test('foldersWithSessions() lists every distinct folder that currently has a session', async () => {
  seed('fws-1', { folder: 'alpha-folder' });
  seed('fws-2', { folder: 'beta-folder' });
  seed('fws-3', { folder: null }); // unfiled — shouldn't appear
  const folders = foldersWithSessions();
  assert.ok(folders.includes('alpha-folder'));
  assert.ok(folders.includes('beta-folder'));
  assert.equal(folders.includes(null), false);
});

test('foldersActiveOn() returns filed folders with a session that day, excluding unfiled ones', async () => {
  seed('active-1', { folder: 'active-folder-a', startedAt: '2026-06-01T09:00:00.000Z' });
  seed('active-2', { folder: 'active-folder-a', startedAt: '2026-06-01T11:00:00.000Z' }); // same folder, same day — no duplicate
  seed('active-3', { folder: 'active-folder-b', startedAt: '2026-06-01T09:00:00.000Z' });
  seed('active-4', { folder: null, startedAt: '2026-06-01T09:00:00.000Z' }); // unfiled — excluded
  seed('active-5', { folder: 'active-folder-c', startedAt: '2026-06-02T09:00:00.000Z' }); // different day — excluded

  const folders = foldersActiveOn('2026-06-01');

  assert.deepEqual([...folders].sort(), ['active-folder-a', 'active-folder-b']);
});

test('writePendingKnowledgeText()/pendingKnowledgeReviews() round-trip a staged proposal without touching KNOWLEDGE.md', () => {
  const res = writePendingKnowledgeText('pending-folder', 'proposed knowledge text');
  assert.equal(res.ok, true);
  assert.ok(existsSync(res.path));
  assert.equal(existsSync(join(TREE_DIR, 'pending-folder', 'KNOWLEDGE.md')), false);

  const reviews = pendingKnowledgeReviews();
  const mine = reviews.find((r) => r.folder === 'pending-folder');
  assert.ok(mine);
  assert.equal(mine.text, 'proposed knowledge text');
});

test('promoteKnowledge() writes the pending text as the real KNOWLEDGE.md and clears the pending file', () => {
  writePendingKnowledgeText('promote-folder', 'text to promote');
  const res = promoteKnowledge('promote-folder');
  assert.equal(res.ok, true);
  const kPath = join(TREE_DIR, 'promote-folder', 'KNOWLEDGE.md');
  assert.ok(existsSync(kPath));
  assert.equal(readFileSync(kPath, 'utf8'), 'text to promote');
  assert.equal(pendingKnowledgeReviews().some((r) => r.folder === 'promote-folder'), false);
});

test('promoteKnowledge() fails cleanly when there is no pending proposal for that folder', () => {
  const res = promoteKnowledge('no-such-pending-folder');
  assert.equal(res.ok, false);
});

test('dismissPendingKnowledge() clears the pending file without ever writing KNOWLEDGE.md', () => {
  writePendingKnowledgeText('dismiss-folder', 'text to reject');
  dismissPendingKnowledge('dismiss-folder');
  assert.equal(pendingKnowledgeReviews().some((r) => r.folder === 'dismiss-folder'), false);
  assert.equal(existsSync(join(TREE_DIR, 'dismiss-folder', 'KNOWLEDGE.md')), false);
});

test('dismissPendingKnowledge() on a folder with no pending file is a harmless no-op', () => {
  const res = dismissPendingKnowledge('never-had-one');
  assert.equal(res.ok, true);
});
