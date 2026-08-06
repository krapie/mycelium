import test from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers.js';

useTempHome();

const { emptyNeutral } = await import('../src/schema.js');
const { saveRaw } = await import('../src/scanner.js');
const { buildHandoff } = await import('../src/handoff.js');

function seed(id, overrides = {}) {
  const n = { ...emptyNeutral(id, 'claude'), ...overrides };
  saveRaw(n);
  return n;
}

test('buildHandoff() fails cleanly for a missing session', () => {
  const res = buildHandoff('nope');
  assert.equal(res.ok, false);
});

test('buildHandoff() includes the original request, summary, files, decisions, todos, and last assistant message', () => {
  seed('hb-full', {
    cwd: '/repo',
    turns: [
      { role: 'user', text: 'please fix the login bug' },
      { role: 'assistant', text: 'looking into it' },
      { role: 'assistant', text: 'fixed, see the diff' },
    ],
    extracted: { title: 'x', tags: [], summary: 'fixed the login bug', decisions: ['use bcrypt'], todos: ['add a test'] },
    artifacts: { filesChanged: ['src/auth.js'], diffSummary: null },
  });

  const res = buildHandoff('hb-full');

  assert.equal(res.ok, true);
  assert.match(res.prompt, /please fix the login bug/);
  assert.match(res.prompt, /fixed the login bug/);
  assert.match(res.prompt, /src\/auth\.js/);
  assert.match(res.prompt, /use bcrypt/);
  assert.match(res.prompt, /add a test/);
  assert.match(res.prompt, /fixed, see the diff/);
});

test('buildHandoff() skips a synthetic first turn and uses the first REAL user message instead', () => {
  seed('hb-synthetic', {
    turns: [
      { role: 'user', text: '<local-command-caveat>ignore me</local-command-caveat>' },
      { role: 'user', text: 'the actual real request' },
    ],
  });

  const res = buildHandoff('hb-synthetic');

  assert.match(res.prompt, /the actual real request/);
  assert.doesNotMatch(res.prompt, /local-command-caveat/);
});

test('buildHandoff() falls back to "(원 요청 없음)" when every user turn is synthetic', () => {
  seed('hb-all-synthetic', {
    turns: [{ role: 'user', text: '<system-reminder>only synthetic</system-reminder>' }],
  });

  const res = buildHandoff('hb-all-synthetic');

  assert.match(res.prompt, /원 요청 없음/);
});

test('buildHandoff() omits optional sections that are empty rather than blanking them', () => {
  seed('hb-minimal', { turns: [{ role: 'user', text: 'just a bare request' }] });

  const res = buildHandoff('hb-minimal');

  assert.doesNotMatch(res.prompt, /지금까지 한 일/);
  assert.doesNotMatch(res.prompt, /건드린 파일/);
  assert.doesNotMatch(res.prompt, /내려진 결정/);
  assert.doesNotMatch(res.prompt, /남은 할 일/);
});
