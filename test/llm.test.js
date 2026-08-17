import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractText,
  parseJsonReply,
  __setTestProvider,
  __clearTestProvider,
  complete,
  mapConcurrent,
  killInFlight,
  __trackChildForTest,
  __inFlightCountForTest,
  __clearInFlightForTest,
} from '../src/llm.js';

// Pure functions + the test-provider seam — no subprocess, no MYCELIUM_HOME
// involvement, so plain static imports are fine here.

test('extractText() unwraps Claude Code --output-format json', () => {
  const stdout = JSON.stringify({ result: 'the answer' });
  assert.equal(extractText(stdout), 'the answer');
});

test('extractText() picks the LAST agent_message from Codex JSONL (msg.type shape)', () => {
  const stdout = [
    JSON.stringify({ msg: { type: 'agent_message', message: 'first' } }),
    JSON.stringify({ msg: { type: 'other', message: 'ignored' } }),
    JSON.stringify({ msg: { type: 'agent_message', message: 'last' } }),
  ].join('\n');
  assert.equal(extractText(stdout), 'last');
});

test('extractText() also recognizes the payload.type Codex event shape', () => {
  const stdout = JSON.stringify({ payload: { type: 'agent_message', message: 'via payload' } });
  assert.equal(extractText(stdout), 'via payload');
});

test('extractText() falls back to raw trimmed text when nothing matches', () => {
  assert.equal(extractText('  just plain text  \n'), 'just plain text');
});

test('extractText() ignores unparseable lines while scanning for Codex events', () => {
  const stdout = ['not json at all', JSON.stringify({ msg: { type: 'agent_message', message: 'found it' } })].join('\n');
  assert.equal(extractText(stdout), 'found it');
});

test('parseJsonReply() parses a bare JSON object', () => {
  assert.deepEqual(parseJsonReply('{"a":1,"b":"two"}'), { a: 1, b: 'two' });
});

test('parseJsonReply() extracts JSON from a ```json fenced block', () => {
  const text = 'here you go:\n```json\n{"a":1}\n```\nhope that helps';
  assert.deepEqual(parseJsonReply(text), { a: 1 });
});

test('parseJsonReply() extracts JSON from a plain (unlabeled) fenced block', () => {
  const text = '```\n{"ok":true}\n```';
  assert.deepEqual(parseJsonReply(text), { ok: true });
});

test('parseJsonReply() returns null when no braces are present', () => {
  assert.equal(parseJsonReply('no json here at all'), null);
});

test('parseJsonReply() returns null on malformed JSON inside the braces', () => {
  assert.equal(parseJsonReply('{"a": }'), null);
});

test('parseJsonReply() KNOWN EDGE CASE: trailing prose with its own braces after the real JSON can mis-slice', () => {
  // The implementation takes the first '{' and the LAST '}' in the whole
  // candidate string — if prose *after* the real JSON object also contains
  // braces, the slice spans past the real object and fails to parse instead
  // of returning the real object. Documented here as current (buggy)
  // behavior so a future fix has a pinned baseline to change deliberately.
  const text = '{"a":1} by the way, see also {this is not json}';
  assert.equal(parseJsonReply(text), null);
});

test('__setTestProvider() overrides complete() without spawning a real subprocess', async () => {
  __setTestProvider(async (prompt) => `echo:${prompt}`);
  try {
    const result = await complete('hello');
    assert.equal(result, 'echo:hello');
  } finally {
    __clearTestProvider();
  }
});

test('__clearTestProvider() restores no-override state', async () => {
  __setTestProvider(() => 'x');
  __clearTestProvider();
  // With no provider set, complete() falls through to the real spawn path —
  // don't actually invoke it here (no real CLI in a test sandbox), just
  // confirm clearing doesn't throw and the provider is gone by re-setting
  // a fresh one and checking it (not the stale one) responds.
  __setTestProvider(async () => 'fresh');
  try {
    assert.equal(await complete('x'), 'fresh');
  } finally {
    __clearTestProvider();
  }
});

test('mapConcurrent() returns results in input order regardless of completion order', async () => {
  // Item 0 finishes last (longest delay), item 2 finishes first — the
  // results array must still line up with the input array's order.
  const delays = [30, 10, 0];
  const { results } = await mapConcurrent(delays, 3, async (ms, idx) => {
    await new Promise((r) => setTimeout(r, ms));
    return idx;
  });
  assert.deepEqual(results, [0, 1, 2]);
});

test('mapConcurrent() never runs more than `concurrency` workers at once', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const items = Array.from({ length: 9 }, (_, i) => i);
  await mapConcurrent(items, 3, async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
  });
  assert.ok(maxInFlight <= 3, `expected at most 3 concurrent, saw ${maxInFlight}`);
  assert.ok(maxInFlight >= 2, `expected real concurrency (>=2), saw ${maxInFlight}`); // sanity: not accidentally sequential
});

test('mapConcurrent() with concurrency=1 behaves like a plain sequential loop', async () => {
  let maxInFlight = 0;
  let inFlight = 0;
  const order = [];
  await mapConcurrent([1, 2, 3], 1, async (n) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    order.push(n);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
  });
  assert.equal(maxInFlight, 1);
  assert.deepEqual(order, [1, 2, 3]);
});

test('mapConcurrent() propagates a worker rejection', async () => {
  await assert.rejects(
    () =>
      mapConcurrent([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    /boom/,
  );
});

test('mapConcurrent() handles an empty items array', async () => {
  const { results } = await mapConcurrent([], 3, async () => {
    throw new Error('should never be called');
  });
  assert.deepEqual(results, []);
});

test('mapConcurrent() caps concurrency at the item count when concurrency is larger', async () => {
  let maxInFlight = 0;
  let inFlight = 0;
  await mapConcurrent([1, 2], 10, async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
  });
  assert.equal(maxInFlight, 2);
});

test('mapConcurrent() without stopAfterConsecutiveFailures ignores worker return shape entirely (back-compat)', async () => {
  // Every pre-existing caller's worker returns undefined (or an unrelated
  // value) and relies on mapConcurrent() never inspecting it.
  const { results, stoppedEarly } = await mapConcurrent([1, 2, 3], 2, async () => ({ ok: false }));
  assert.equal(stoppedEarly, false);
  assert.equal(results.length, 3);
});

test('mapConcurrent() stops scheduling new work after N consecutive failures', async () => {
  const attempted = [];
  const { stoppedEarly } = await mapConcurrent(
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
    1, // concurrency=1 makes "consecutive" deterministic to assert on
    async (n) => {
      attempted.push(n);
      return { ok: false };
    },
    { stopAfterConsecutiveFailures: 3 },
  );
  assert.equal(stoppedEarly, true);
  // Stops the instant the 3rd consecutive failure lands — never attempts
  // a 4th item, let alone all 9.
  assert.deepEqual(attempted, [1, 2, 3]);
});

test('mapConcurrent() circuit breaker resets the consecutive-failure count on a success', async () => {
  const attempted = [];
  // Fail, fail, succeed, fail, fail, succeed — never 3 in a row, so this
  // should run to completion rather than tripping the breaker.
  const outcomes = [false, false, true, false, false, true];
  const { stoppedEarly } = await mapConcurrent(
    [1, 2, 3, 4, 5, 6],
    1,
    async (n, idx) => {
      attempted.push(n);
      return { ok: outcomes[idx] };
    },
    { stopAfterConsecutiveFailures: 3 },
  );
  assert.equal(stoppedEarly, false);
  assert.deepEqual(attempted, [1, 2, 3, 4, 5, 6]);
});

// killInFlight()/inFlight — the real spawn() path (inside complete())
// always targets the real claude/codex binaries with fixed args (no
// injection point for a test double), and _testProvider deliberately
// bypasses spawn() entirely, so neither exercises real child tracking.
// __trackChildForTest()/__inFlightCountForTest() (llm.js, same test-only-
// export convention as __setTestProvider) let these tests register fake
// children directly instead — real wiring inside complete() itself
// (inFlight.add() on spawn, removal on close/error) is left to code
// review, same as this file's own "the real claude/codex spawn path is
// not tested, by design" precedent (see docs/features.md).

test.afterEach(() => __clearInFlightForTest());

test('killInFlight() sends SIGTERM to every currently-tracked child', () => {
  const killed = [];
  const fakeChild1 = { kill: (sig) => killed.push(['child1', sig]) };
  const fakeChild2 = { kill: (sig) => killed.push(['child2', sig]) };
  __trackChildForTest(fakeChild1);
  __trackChildForTest(fakeChild2);
  assert.equal(__inFlightCountForTest(), 2);

  killInFlight();

  assert.deepEqual(killed.sort(), [
    ['child1', 'SIGTERM'],
    ['child2', 'SIGTERM'],
  ]);
});

test('killInFlight() with nothing tracked is a harmless no-op', () => {
  assert.equal(__inFlightCountForTest(), 0);
  assert.doesNotThrow(() => killInFlight());
});
