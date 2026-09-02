import test from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers.js';

useTempHome();

const { emptyNeutral } = await import('../src/schema.js');
const { saveRaw, loadRaw, deleteRaw } = await import('../src/scanner.js');
const { __setTestProvider, __clearTestProvider } = await import('../src/llm.js');
const { autoTagSession, tagAll } = await import('../src/learn.js');
const { loadConfig, saveConfig } = await import('../src/config.js');

function seed(id, overrides = {}) {
  const n = { ...emptyNeutral(id, 'claude'), ...overrides };
  saveRaw(n);
  return n;
}

function mockReply({ title = 'A Title', tags = ['tag-a'], summary = 'a summary', decisions = [], todos = [] } = {}) {
  return JSON.stringify({ title, tags, summary, decisions, todos });
}

// contentLocale() (config.js) reads config.json fresh each call — reset
// after every test so a locale change can't leak into a later one.
test.afterEach(() => {
  __clearTestProvider();
  saveConfig({ ...loadConfig(), locale: 'en' });
});

test('autoTagSession() sends an English prompt by default, Korean when locale is ko', async () => {
  seed('learn-locale-en', { turns: [{ role: 'user', text: 'help me fix the bug' }] });
  let seenPrompt;
  __setTestProvider(async (prompt) => {
    seenPrompt = prompt;
    return mockReply();
  });
  await autoTagSession('learn-locale-en');
  assert.doesNotMatch(seenPrompt, /[가-힣]/, 'default locale (en) prompt must not contain Korean instructions');

  saveConfig({ ...loadConfig(), locale: 'ko' });
  seed('learn-locale-ko', { turns: [{ role: 'user', text: 'help me fix the bug' }] });
  __setTestProvider(async (prompt) => {
    seenPrompt = prompt;
    return mockReply();
  });
  await autoTagSession('learn-locale-ko');
  assert.match(seenPrompt, /[가-힣]/, 'ko locale prompt must contain Korean instructions');
});

test('autoTagSession() writes title/tags/summary/decisions/todos and stamps summarizedTurnCount', async () => {
  seed('learn-1', { turns: [{ role: 'user', text: 'help me fix the bug' }] });
  __setTestProvider(async () => mockReply({ title: 'Fix bug', tags: ['bug', 'fix'], summary: 'fixed the bug', decisions: ['use X'], todos: ['write tests'] }));

  const res = await autoTagSession('learn-1');

  assert.equal(res.ok, true);
  assert.equal(res.session.extracted.title, 'Fix bug');
  assert.deepEqual(res.session.extracted.tags, ['bug', 'fix']);
  assert.equal(res.session.extracted.summary, 'fixed the bug');
  assert.deepEqual(res.session.extracted.decisions, ['use X']);
  assert.deepEqual(res.session.extracted.todos, ['write tests']);
  assert.equal(res.session.summarizedTurnCount, 1);
  assert.equal(loadRaw('learn-1').extracted.title, 'Fix bug');
});

test('autoTagSession() caps tags at 5', async () => {
  seed('learn-cap', { turns: [{ role: 'user', text: 'hi' }] });
  __setTestProvider(async () => mockReply({ tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }));
  const res = await autoTagSession('learn-cap');
  assert.equal(res.session.extracted.tags.length, 5);
});

test('autoTagSession() on an empty session fails without calling the LLM', async () => {
  seed('learn-empty', { turns: [] });
  let called = false;
  __setTestProvider(async () => {
    called = true;
    return mockReply();
  });
  const res = await autoTagSession('learn-empty');
  assert.equal(res.ok, false);
  assert.match(res.error, /empty session/);
  assert.equal(called, false);
  // An empty-turn session can never gain a summary, so it would otherwise
  // stay a perpetually-eligible (but always-failing) target for every
  // *later* unscoped tagAll() call in this file's shared store — clean it
  // up so it doesn't skew other tests' target counts/ordering.
  deleteRaw('learn-empty');
});

test('autoTagSession() never overwrites a titleLocked title, but still refreshes tags/summary', async () => {
  seed('learn-locked', { turns: [{ role: 'user', text: 'hi' }], titleLocked: true, extracted: { title: 'Human Title', tags: [], summary: null, decisions: [], todos: [] } });
  __setTestProvider(async () => mockReply({ title: 'LLM would rename this', tags: ['fresh'], summary: 'fresh summary' }));

  const res = await autoTagSession('learn-locked');

  assert.equal(res.session.extracted.title, 'Human Title');
  assert.deepEqual(res.session.extracted.tags, ['fresh']);
  assert.equal(res.session.extracted.summary, 'fresh summary');
});

test('autoTagSession() returns ok:false and leaves the session untouched when the LLM reply is unparseable', async () => {
  seed('learn-bad-reply', { turns: [{ role: 'user', text: 'hi' }], extracted: { title: 'Original', tags: [], summary: null, decisions: [], todos: [] } });
  __setTestProvider(async () => 'not json at all, sorry');

  const res = await autoTagSession('learn-bad-reply');

  assert.equal(res.ok, false);
  assert.match(res.error, /unparseable/);
  assert.equal(loadRaw('learn-bad-reply').extracted.title, 'Original');
});

test('autoTagSession() reports a clean error when the LLM call itself fails', async () => {
  seed('learn-throws', { turns: [{ role: 'user', text: 'hi' }] });
  __setTestProvider(async () => {
    throw new Error('subprocess exploded');
  });

  const res = await autoTagSession('learn-throws');

  assert.equal(res.ok, false);
  assert.match(res.error, /LLM failed: subprocess exploded/);
});

test('tagAll() skips a session that already has a summary and has not grown', async () => {
  seed('tagall-skip', {
    turns: [{ role: 'user', text: 'hi' }],
    summarizedTurnCount: 1,
    extracted: { title: 'x', tags: [], summary: 'already summarized', decisions: [], todos: [] },
  });
  __setTestProvider(async () => mockReply());

  const res = await tagAll();

  assert.equal(res.skipped >= 1, true);
  assert.equal(loadRaw('tagall-skip').extracted.summary, 'already summarized');
});

test('tagAll() never summarizes an _archive session, even with force', async () => {
  // Capture's auto-archived old backlog must stay out of the daemon's
  // automatic summarize pass — see learn.js's tagAll() and scanner.js.
  seed('tagall-archived', { folder: '_archive', turns: [{ role: 'user', text: 'old archived work' }] });
  __setTestProvider(async () => mockReply({ summary: 'should never be written' }));

  await tagAll({ force: true });

  // force:true re-tags every non-archived session in the shared store, but
  // the archived one is skipped, so its summary stays untouched (null).
  assert.equal(loadRaw('tagall-archived').extracted.summary, null);
});

test('tagAll() re-tags a session that grew since its last summarization', async () => {
  seed('tagall-grew', {
    turns: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'ok' }, { role: 'user', text: 'more' }],
    summarizedTurnCount: 1, // stale — session has grown to 3 turns since
    extracted: { title: 'x', tags: [], summary: 'stale summary', decisions: [], todos: [] },
  });
  __setTestProvider(async () => mockReply({ summary: 'fresh summary' }));

  const res = await tagAll();

  assert.equal(res.tagged, 1);
  assert.equal(loadRaw('tagall-grew').extracted.summary, 'fresh summary');
});

test('tagAll({force:true}) re-tags even an up-to-date session', async () => {
  seed('tagall-force', {
    turns: [{ role: 'user', text: 'hi' }],
    summarizedTurnCount: 1,
    extracted: { title: 'x', tags: [], summary: 'already summarized', decisions: [], todos: [] },
  });
  __setTestProvider(async () => mockReply({ summary: 'forced fresh' }));

  const res = await tagAll({ force: true });

  // force:true ignores the up-to-date check for EVERY session in the store
  // (not just this test's own), so it isn't scoped to just tagall-force —
  // assert this session was included, not an exact total.
  assert.ok(res.tagged >= 1);
  assert.equal(loadRaw('tagall-force').extracted.summary, 'forced fresh');
});

test('tagAll({limit}) processes the oldest sessions first and stops at the limit', async () => {
  seed('tagall-old', { startedAt: '2026-01-01T00:00:00.000Z', turns: [{ role: 'user', text: 'old one' }] });
  seed('tagall-new', { startedAt: '2026-01-05T00:00:00.000Z', turns: [{ role: 'user', text: 'new one' }] });
  const seenIds = [];
  __setTestProvider(async (prompt) => {
    seenIds.push(prompt.includes('old one') ? 'tagall-old' : prompt.includes('new one') ? 'tagall-new' : '?');
    return mockReply();
  });

  const res = await tagAll({ limit: 1 });

  assert.equal(res.tagged, 1);
  assert.deepEqual(seenIds, ['tagall-old']);
  // tagall-new is deliberately left untagged by limit:1 — clean both up so
  // neither leaks into a later unscoped tagAll() call in this file.
  deleteRaw('tagall-old');
  deleteRaw('tagall-new');
});

test('tagAll() accumulates newly-seen tags into the shared vocabulary passed to later calls', async () => {
  seed('vocab-1', { startedAt: '2026-01-01T00:00:00.000Z', turns: [{ role: 'user', text: 'first session' }] });
  seed('vocab-2', { startedAt: '2026-01-02T00:00:00.000Z', turns: [{ role: 'user', text: 'second session' }] });
  const seenPrompts = [];
  __setTestProvider(async (prompt) => {
    seenPrompts.push(prompt);
    if (seenPrompts.length === 1) return mockReply({ tags: ['freshly-coined-tag'] });
    return mockReply({ tags: ['unrelated'] });
  });

  await tagAll();

  assert.equal(seenPrompts.length, 2);
  assert.match(seenPrompts[1], /freshly-coined-tag/);
});

test('tagAll({concurrency}) actually runs multiple autoTagSession() calls in flight at once', async () => {
  seed('conc-1', { startedAt: '2026-02-01T00:00:00.000Z', turns: [{ role: 'user', text: 'session one' }] });
  seed('conc-2', { startedAt: '2026-02-02T00:00:00.000Z', turns: [{ role: 'user', text: 'session two' }] });
  seed('conc-3', { startedAt: '2026-02-03T00:00:00.000Z', turns: [{ role: 'user', text: 'session three' }] });
  let inFlight = 0;
  let maxInFlight = 0;
  __setTestProvider(async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 10));
    inFlight--;
    return mockReply();
  });

  const res = await tagAll({ concurrency: 3 });

  assert.ok(res.tagged >= 3);
  assert.ok(maxInFlight >= 2, `expected real concurrency (>=2), saw ${maxInFlight}`);
  assert.ok(maxInFlight <= 3, `expected at most concurrency=3, saw ${maxInFlight}`);
});

test('tagAll() with no concurrency option stays sequential (default unchanged for existing callers)', async () => {
  seed('seq-1', { startedAt: '2026-03-01T00:00:00.000Z', turns: [{ role: 'user', text: 'seq one' }] });
  seed('seq-2', { startedAt: '2026-03-02T00:00:00.000Z', turns: [{ role: 'user', text: 'seq two' }] });
  let inFlight = 0;
  let maxInFlight = 0;
  __setTestProvider(async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return mockReply();
  });

  await tagAll();

  assert.equal(maxInFlight, 1);
});

test('tagAll() stops after consecutive failures instead of burning through the whole backlog', async () => {
  // Deliberately dated before every other test in this file's shared store
  // (see AGENTS.md's "shared temp store persists across tests in one
  // file") — oldest-first ordering guarantees these are the first ones
  // tagAll() attempts, so the circuit breaker trips on exactly these,
  // independent of whatever other tests left lying around.
  for (let i = 0; i < 9; i++) {
    seed(`circuit-${i}`, { startedAt: `1990-01-0${i + 1}T00:00:00.000Z`, turns: [{ role: 'user', text: `circuit call ${i}` }] });
  }
  let calls = 0;
  __setTestProvider(async () => {
    calls++;
    throw new Error('usage limit');
  });

  const res = await tagAll({ concurrency: 1, stopAfterConsecutiveFailures: 3 });

  assert.equal(res.stoppedEarly, true);
  assert.equal(calls, 3); // never attempted the remaining 6, let alone anything else in the store
});

// Issue #70 (prompt quality) — the new instructions actually reach the
// prompt, in both locales. Not testing model behavior (that needs a real
// LLM — see scripts/eval-prompts.js), just that the wording is present.
test('buildPrompt() carries the new tag near-duplicate/no-generic-activity guard, both locales', async () => {
  seed('learn-tag-guard-en', { turns: [{ role: 'user', text: 'fix the login flow' }] });
  let seenPrompt;
  __setTestProvider(async (prompt) => {
    seenPrompt = prompt;
    return mockReply();
  });
  await autoTagSession('learn-tag-guard-en');
  assert.match(seenPrompt, /near-synonym/, 'EN prompt names the near-duplicate-tag guard');
  assert.match(seenPrompt, /tool name/, 'EN prompt bans tool-name tags');

  saveConfig({ ...loadConfig(), locale: 'ko' });
  seed('learn-tag-guard-ko', { turns: [{ role: 'user', text: 'fix the login flow' }] });
  __setTestProvider(async (prompt) => {
    seenPrompt = prompt;
    return mockReply();
  });
  await autoTagSession('learn-tag-guard-ko');
  assert.match(seenPrompt, /뜻이 비슷한 다른 표현/, 'ko prompt names the near-duplicate-tag guard');
  assert.match(seenPrompt, /도구 이름/, 'ko prompt bans tool-name tags');
});

test('buildPrompt() carries the thin-content fallback rule and the single-JSON-object output rule, both locales', async () => {
  seed('learn-thin-en', { turns: [{ role: 'user', text: 'hi' }] });
  let seenPrompt;
  __setTestProvider(async (prompt) => {
    seenPrompt = prompt;
    return mockReply();
  });
  await autoTagSession('learn-thin-en');
  assert.match(seenPrompt, /Thin sessions/, 'EN prompt has the thin-content rule');
  assert.match(seenPrompt, /exactly one JSON object/, 'EN prompt states the single-JSON-object output rule');

  saveConfig({ ...loadConfig(), locale: 'ko' });
  seed('learn-thin-ko', { turns: [{ role: 'user', text: '안녕' }] });
  __setTestProvider(async (prompt) => {
    seenPrompt = prompt;
    return mockReply();
  });
  await autoTagSession('learn-thin-ko');
  assert.match(seenPrompt, /내용이 얇은 세션/, 'ko prompt has the thin-content rule');
  assert.match(seenPrompt, /JSON 객체 하나뿐/, 'ko prompt states the single-JSON-object output rule');
});

// Guards against the exact class of bug commit 2 was designed to avoid —
// see llm.js's own comment on why a wording change already broke
// something once. tutorial-mock-llm.js's mockAutotag() finds the FIRST
// line starting with "user:" in the prompt and treats it as the real
// transcript; any future few-shot example containing a literal
// "user:"/"assistant:" line would silently feed it fake content instead,
// with every session in mycelium demo getting an identical canned title.
test('buildPrompt() never contains a literal transcript-line shape outside the real session excerpt', () => {
  seed('learn-collision-guard', { turns: [{ role: 'user', text: 'a real user turn' }] });
  let seenPrompt;
  __setTestProvider(async (prompt) => {
    seenPrompt = prompt;
    return mockReply();
  });
  return autoTagSession('learn-collision-guard').then(() => {
    // Exactly one "user:" line is expected — the real excerpt itself
    // (sessionExcerpt() renders turns as "role: text"). More than one
    // means an example snippet leaked a second one in.
    const userLines = (seenPrompt.match(/^user:/gm) || []).length;
    assert.equal(userLines, 1, 'exactly one real "user:" transcript line, no leaked example');
  });
});
