import test from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers.js';

useTempHome();

const { emptyNeutral } = await import('../src/schema.js');
const { loadRaw, saveRaw } = await import('../src/scanner.js');
const { __setTestProvider, __clearTestProvider } = await import('../src/llm.js');
const { applySplit, unsplit, suggestSplitBoundaries } = await import('../src/split.js');
const { loadConfig, saveConfig } = await import('../src/config.js');

function seed(id, overrides = {}) {
  const n = { ...emptyNeutral(id, 'claude'), ...overrides };
  saveRaw(n);
  return n;
}

// contentLocale() (config.js) reads config.json fresh on every call — reset
// after every test, not just the one that sets 'ko', so a locale change
// can't leak into a later test the way i18n.js's own module-level locale
// cache warns about elsewhere in this codebase.
test.afterEach(() => {
  __clearTestProvider();
  saveConfig({ ...loadConfig(), locale: 'en' });
});

function turns(n) {
  return Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', text: `turn ${i + 1}` }));
}

test('applySplit() slices 1-indexed inclusive turn ranges into new sessions', () => {
  seed('split-src', { source: 'claude', folder: 'work', cwd: '/repo', turns: turns(6) });
  const res = applySplit('split-src', [
    { from: 1, to: 2, label: 'first topic' },
    { from: 3, to: 6, label: 'second topic' },
  ]);
  assert.equal(res.ok, true);
  assert.equal(res.pieces.length, 2);
  assert.deepEqual(res.pieces[0].turns.map((t) => t.text), ['turn 1', 'turn 2']);
  assert.deepEqual(res.pieces[1].turns.map((t) => t.text), ['turn 3', 'turn 4', 'turn 5', 'turn 6']);
});

test('applySplit() pieces inherit source/cwd/folder and are marked human-owned; original gets splitInto', () => {
  seed('split-src2', { source: 'codex', folder: 'work/proj', cwd: '/repo/proj', turns: turns(4) });
  const res = applySplit('split-src2', [{ from: 1, to: 4, label: 'whole thing' }]);
  const piece = res.pieces[0];
  assert.equal(piece.source, 'codex');
  assert.equal(piece.cwd, '/repo/proj');
  assert.equal(piece.folder, 'work/proj');
  assert.equal(piece.organizedBy, 'human');
  assert.equal(piece.splitFrom, 'split-src2');
  assert.equal(piece.extracted.title, 'whole thing');

  const original = loadRaw('split-src2');
  assert.deepEqual(original.splitInto, [piece.id]);
});

test("applySplit() propagates demo:true from the original so tutorial.js's endTutorial() sweep still catches split pieces", () => {
  seed('split-demo', { demo: true, turns: turns(4) });
  const res = applySplit('split-demo', [{ from: 1, to: 4, label: 'whole thing' }]);
  assert.equal(res.pieces[0].demo, true);
});

test('applySplit() leaves demo unset when the original was not a demo session', () => {
  seed('split-real', { turns: turns(4) });
  const res = applySplit('split-real', [{ from: 1, to: 4, label: 'whole thing' }]);
  assert.ok(!res.pieces[0].demo);
});

test('applySplit() skips a range that produces an empty slice', () => {
  seed('split-src3', { turns: turns(3) });
  // from > turns.length entirely -> slice() yields nothing for that range.
  const res = applySplit('split-src3', [
    { from: 1, to: 2, label: 'valid' },
    { from: 10, to: 12, label: 'out of range' },
  ]);
  assert.equal(res.ok, true);
  assert.equal(res.pieces.length, 1);
});

test('applySplit() fails when every range is empty', () => {
  seed('split-src4', { turns: turns(2) });
  const res = applySplit('split-src4', [{ from: 10, to: 12, label: 'nowhere' }]);
  assert.equal(res.ok, false);
});

test('applySplit() fails with no ranges or a missing session', () => {
  seed('split-src5', { turns: turns(2) });
  assert.equal(applySplit('split-src5', []).ok, false);
  assert.equal(applySplit('nonexistent', [{ from: 1, to: 1 }]).ok, false);
});

test('unsplit() deletes the pieces and clears the original splitInto marker', () => {
  seed('split-src6', { turns: turns(4) });
  const split = applySplit('split-src6', [
    { from: 1, to: 2, label: 'a' },
    { from: 3, to: 4, label: 'b' },
  ]);
  const pieceIds = split.pieces.map((p) => p.id);

  const res = unsplit('split-src6');
  assert.equal(res.ok, true);
  assert.deepEqual(res.removed.sort(), pieceIds.sort());
  for (const id of pieceIds) assert.equal(loadRaw(id), null);
  assert.deepEqual(loadRaw('split-src6').splitInto, []);
});

test('unsplit() only removes pieces whose splitFrom still points back at this original (defensive check)', () => {
  seed('split-src7', { turns: turns(2) });
  const split = applySplit('split-src7', [{ from: 1, to: 2, label: 'a' }]);
  const pieceId = split.pieces[0].id;

  // Simulate the piece having been re-parented elsewhere (splitFrom no
  // longer matches) — unsplit() must not delete it out from under that.
  const piece = loadRaw(pieceId);
  piece.splitFrom = 'someone-else';
  saveRaw(piece);

  const res = unsplit('split-src7');
  assert.equal(res.ok, true);
  assert.deepEqual(res.removed, []);
  assert.ok(loadRaw(pieceId));
});

test('unsplit() rejects a session that was never split', () => {
  seed('split-src8', { turns: turns(2) });
  const res = unsplit('split-src8');
  assert.equal(res.ok, false);
});

test('unsplit() on a missing id returns ok:false', () => {
  const res = unsplit('nope');
  assert.equal(res.ok, false);
});

test('suggestSplitBoundaries() refuses sessions under 4 turns without calling the LLM', async () => {
  seed('sb-short', { turns: turns(3) });
  let called = false;
  __setTestProvider(async () => {
    called = true;
    return JSON.stringify({ ranges: [] });
  });
  const res = await suggestSplitBoundaries('sb-short');
  assert.equal(res.ok, false);
  assert.equal(called, false);
});

test('suggestSplitBoundaries() returns ranges validated against the turn count', async () => {
  seed('sb-valid', { turns: turns(6) });
  __setTestProvider(async () =>
    JSON.stringify({
      ranges: [
        { from: 1, to: 3, label: 'first half' },
        { from: 4, to: 6, label: 'second half' },
      ],
    }),
  );
  const res = await suggestSplitBoundaries('sb-valid');
  assert.equal(res.ok, true);
  assert.equal(res.ranges.length, 2);
  assert.deepEqual(res.ranges[0], { from: 1, to: 3, label: 'first half' });
});

test('suggestSplitBoundaries() drops out-of-bounds and non-integer ranges from the LLM reply', async () => {
  seed('sb-bounds', { turns: turns(4) });
  __setTestProvider(async () =>
    JSON.stringify({
      ranges: [
        { from: 1, to: 2, label: 'valid' },
        { from: 3, to: 10, label: 'out of bounds' }, // to > turns.length
        { from: 1.5, to: 2, label: 'non-integer from' },
        { from: 2, to: 1, label: 'to < from' },
      ],
    }),
  );
  const res = await suggestSplitBoundaries('sb-bounds');
  assert.equal(res.ok, true);
  assert.equal(res.ranges.length, 1);
  assert.deepEqual(res.ranges[0], { from: 1, to: 2, label: 'valid' });
});

test('suggestSplitBoundaries() falls back to a "Turn N-M" label when the LLM omits one', async () => {
  // Default locale (config.js's contentLocale() falls back to 'en' —
  // see split.js/contentLocale() for why prompts and this fallback label
  // now follow config.json's locale instead of being Korean-only).
  seed('sb-nolabel', { turns: turns(4) });
  __setTestProvider(async () => JSON.stringify({ ranges: [{ from: 1, to: 4 }] }));
  const res = await suggestSplitBoundaries('sb-nolabel');
  assert.equal(res.ok, true);
  assert.equal(res.ranges[0].label, 'Turn 1-4');
});

test('suggestSplitBoundaries() falls back to a "턴 N-M" label when locale is ko', async () => {
  saveConfig({ ...loadConfig(), locale: 'ko' });
  seed('sb-nolabel-ko', { turns: turns(4) });
  let seenPrompt;
  __setTestProvider(async (prompt) => {
    seenPrompt = prompt;
    return JSON.stringify({ ranges: [{ from: 1, to: 4 }] });
  });
  const res = await suggestSplitBoundaries('sb-nolabel-ko');
  assert.equal(res.ok, true);
  assert.equal(res.ranges[0].label, '턴 1-4');
  assert.match(seenPrompt, /[가-힣]/, 'the prompt sent to the LLM is Korean when locale is ko');
});

test('suggestSplitBoundaries() fails when every proposed range is invalid', async () => {
  seed('sb-allbad', { turns: turns(4) });
  __setTestProvider(async () => JSON.stringify({ ranges: [{ from: 99, to: 100, label: 'nowhere' }] }));
  const res = await suggestSplitBoundaries('sb-allbad');
  assert.equal(res.ok, false);
});

test('suggestSplitBoundaries() reports a clean error when the LLM call fails', async () => {
  seed('sb-throws', { turns: turns(4) });
  __setTestProvider(async () => {
    throw new Error('llm down');
  });
  const res = await suggestSplitBoundaries('sb-throws');
  assert.equal(res.ok, false);
  assert.match(res.error, /llm down/);
});
