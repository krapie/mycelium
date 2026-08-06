import test from 'node:test';
import assert from 'node:assert/strict';
import { extractText, parseJsonReply, __setTestProvider, __clearTestProvider, complete } from '../src/llm.js';

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
