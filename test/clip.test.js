/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers.js';

const home = useTempHome();

const { createClip, listClips, findClip, deleteClip, clipFolder, lastTurnsRange, recentAnswers, setClipNote } = await import('../src/clip.js');
const { saveRaw, loadRaw } = await import('../src/scanner.js');
const { emptyNeutral } = await import('../src/schema.js');
const { createBacklog } = await import('../src/backlog.js');
const { deleteSession, move } = await import('../src/organize.js');
const { buildKnowledgeText } = await import('../src/insight.js');
const { __setTestProvider, __clearTestProvider } = await import('../src/llm.js');
const { ADAPTERS } = await import('../src/adapters/index.js');

test.afterEach(() => __clearTestProvider());

const CLI_PATH = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const runCli = (args, extraEnv = {}) => spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: 'utf8', env: { ...process.env, MYCELIUM_HOME: home, ...extraEnv } });
// --here scans first; MYCELIUM_DEMO_MODE keeps that scan off the real
// ~/.claude etc. Every adapter's sessionEnv is cleared, not just Claude
// Code's: run from inside any agent whose CLI exports one, the test process
// inherits the real id, and resolveHere() prefers whichever transcript is
// newest — so an inherited KIRO_SESSION_ID would quietly win over the id a
// test passes. Derived from ADAPTERS so adding an agent can't leave this
// list behind.
const SESSION_ENVS = ADAPTERS.map((a) => a.sessionEnv).filter(Boolean);
const runHere = (args, sessionId, envName = 'CLAUDE_CODE_SESSION_ID') => {
  const env = { ...process.env, MYCELIUM_HOME: home, MYCELIUM_DEMO_MODE: '1' };
  for (const k of SESSION_ENVS) delete env[k];
  if (sessionId) env[envName] = sessionId;
  return spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: 'utf8', env });
};

function seed(id, folder, texts) {
  const n = emptyNeutral(id, 'claude');
  n.folder = folder;
  n.extracted.summary = `summary of ${id}`;
  n.turns = texts.map((text, i) => ({ role: i % 2 ? 'assistant' : 'user', text }));
  saveRaw(n);
  return n;
}

test('createClip() copies the picked turns verbatim, 1-based and inclusive', () => {
  seed('clip-basic', 'proj', ['how do I cache?', 'Put cachePoint at each layer boundary.', 'thanks']);
  const res = createClip({ sessionId: 'clip-basic', from: 1, to: 2, note: 'caching' });
  assert.equal(res.ok, true);
  assert.deepEqual(
    res.clip.turns.map((t) => t.text),
    ['how do I cache?', 'Put cachePoint at each layer boundary.'],
  );
  assert.equal(res.clip.note, 'caching');
  assert.equal(res.clip.folder, 'proj');
  assert.equal(findClip(res.clip.id.slice(0, 8)).clip.id, res.clip.id);
});

test('createClip() rejects an out-of-range turn range, a missing session, and a backlog item', () => {
  seed('clip-range', 'proj', ['a', 'b']);
  assert.equal(createClip({ sessionId: 'clip-range', from: 0 }).ok, false);
  assert.equal(createClip({ sessionId: 'clip-range', from: 2, to: 1 }).ok, false);
  assert.equal(createClip({ sessionId: 'clip-range', from: 1, to: 3 }).ok, false);
  assert.equal(createClip({ sessionId: 'no-such-session', from: 1 }).ok, false);
  const note = createBacklog({ title: 'not a conversation' }).session;
  assert.equal(createClip({ sessionId: note.id, from: 1 }).ok, false);
});

test("a clip follows its session's folder when the session is moved", () => {
  seed('clip-move', 'old/place', ['q', 'a']);
  const { clip } = createClip({ sessionId: 'clip-move', from: 2 });
  move('clip-move', 'new/place');
  assert.equal(clipFolder(clip), 'new/place');
  assert.ok(listClips({ folder: 'new' }).some((c) => c.id === clip.id), 'subtree scope uses the live folder');
  assert.ok(!listClips({ folder: 'old' }).some((c) => c.id === clip.id));
});

test('a clip survives its source session being deleted, keeping its pinned folder and text', () => {
  seed('clip-orphan', 'keep/me', ['q', 'the answer worth keeping']);
  const { clip } = createClip({ sessionId: 'clip-orphan', from: 2 });
  deleteSession('clip-orphan');
  assert.equal(loadRaw('clip-orphan'), null);
  const [kept] = listClips({ sessionId: 'clip-orphan' });
  assert.equal(kept.turns[0].text, 'the answer worth keeping');
  assert.equal(clipFolder(kept), 'keep/me');
  assert.equal(deleteClip(clip.id).ok, true);
  assert.equal(findClip(clip.id).ok, false);
});

test("buildKnowledgeText() hands the folder's clips to the LLM as must-reflect material", async () => {
  seed('clip-know', 'know', ['q', 'Always sort requests by category before batching.']);
  createClip({ sessionId: 'clip-know', from: 2, note: 'batching rule' });
  let prompt = '';
  __setTestProvider(async (p) => {
    prompt = p;
    return 'knowledge';
  });
  const res = await buildKnowledgeText('know');
  assert.equal(res.ok, true);
  assert.match(prompt, /Always sort requests by category before batching\./);
  assert.match(prompt, /batching rule/);
});

test('buildKnowledgeText() leaves the prompt unchanged for a folder with no clips', async () => {
  seed('clip-none', 'plain', ['q', 'a']);
  let prompt = '';
  __setTestProvider(async (p) => {
    prompt = p;
    return 'knowledge';
  });
  await buildKnowledgeText('plain');
  assert.doesNotMatch(prompt, /pinned|클립/);
});

test('mycelium clip: add without --turn lists turns, add/list/show/rm round-trip', () => {
  seed('clip-cli-session', 'cli', ['first question', 'the answer']);
  const listing = runCli(['clip', 'add', 'clip-cli']);
  assert.equal(listing.status, 0);
  assert.match(listing.stdout, /2 {2}\[assistant\] the answer/);

  const add = runCli(['clip', 'add', 'clip-cli', '--turn', '2', '--note', 'keeper']);
  assert.equal(add.status, 0, add.stderr);
  const id = add.stdout.match(/^clipped (\w{8})/)[1];

  assert.match(runCli(['clip', 'list', '--folder', 'cli']).stdout, new RegExp(`${id}.*keeper`));
  assert.match(runCli(['clip', 'show', id]).stdout, /the answer/);
  assert.equal(runCli(['clip', 'rm', id]).status, 0);
  assert.equal(runCli(['clip', 'show', id]).status, 1);
});

test('mycelium clip add rejects a malformed --turn', () => {
  seed('clip-cli-bad', 'cli', ['q']);
  const res = runCli(['clip', 'add', 'clip-cli-bad', '--turn', 'two']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Usage: mycelium clip/);
});

test('lastTurnsRange() ends at the newest assistant turn, skipping trailing user turns', () => {
  const turns = ['q1', 'a1', 'q2', 'a2', '/clip keep this'].map((text, i) => ({ role: i % 2 ? 'assistant' : 'user', text }));
  assert.deepEqual(lastTurnsRange(turns, 1), { ok: true, from: 4, to: 4 });
  assert.deepEqual(lastTurnsRange(turns, 3), { ok: true, from: 2, to: 4 });
  assert.deepEqual(lastTurnsRange(turns, 99), { ok: true, from: 1, to: 4 });
  assert.equal(lastTurnsRange([{ role: 'user', text: 'q' }], 1).ok, false);
  assert.equal(lastTurnsRange(turns, 0).ok, false);
});

test('setClipNote() replaces and clears a note', () => {
  seed('clip-note', 'proj', ['q', 'a']);
  const { id } = createClip({ sessionId: 'clip-note', from: 2 }).clip;
  assert.equal(setClipNote(id, '  later  ').clip.note, 'later');
  assert.equal(findClip(id).clip.note, 'later');
  assert.equal(setClipNote(id, '').clip.note, null);
  assert.equal(setClipNote('no-such-clip', 'x').ok, false);
});

test('setClipNote() leaves no temp file behind, and a stray one is never read as a clip', async () => {
  const { readdirSync, writeFileSync: write } = await import('node:fs');
  const { CLIPS_DIR } = await import('../src/paths.js');
  seed('clip-note-atomic', 'proj', ['q', 'a']);
  const { id } = createClip({ sessionId: 'clip-note-atomic', from: 2 }).clip;

  setClipNote(id, 'renamed into place');
  assert.deepEqual(readdirSync(CLIPS_DIR).filter((f) => f.endsWith('.tmp')), [], 'the rename should have consumed it');

  // A temp file left by a killed process must not surface as a clip, nor
  // break the ones that are fine — it isn't *.json, so it never gets read.
  const before = listClips({ sessionId: 'clip-note-atomic' }).length;
  write(`${CLIPS_DIR}/${id}.json.99999.tmp`, '{ truncated');
  assert.equal(listClips({ sessionId: 'clip-note-atomic' }).length, before);
  assert.equal(findClip(id).clip.note, 'renamed into place');
});

test('mycelium clip add --here pins the last answer of the session the agent names', () => {
  seed('clip-here-session', 'here', ['how do I cache?', 'Put cachePoint at each layer boundary.']);
  const res = runHere(['clip', 'add', '--here'], 'clip-here-session');
  assert.equal(res.status, 0, res.stderr);
  const id = res.stdout.match(/^clipped (\w{8}) {2}clip-her turn 2 {2}here/)[1];
  assert.match(res.stdout, /\[assistant\] Put cachePoint/);

  assert.equal(runCli(['clip', 'note', id, 'caching', 'rule']).status, 0);
  assert.equal(findClip(id).clip.note, 'caching rule');

  const two = runHere(['clip', 'add', '--here', '--last', '2'], 'clip-here-session');
  assert.match(two.stdout, /turns 1-2/);
});

test('mycelium clip add --here fails instead of guessing when the agent gives no session id', () => {
  const none = runHere(['clip', 'add', '--here']);
  assert.equal(none.status, 1);
  assert.match(none.stderr, /pass the session id/);
  const missing = runHere(['clip', 'add', '--here'], 'not-captured-anywhere');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /not in the store/);
  assert.equal(runHere(['clip', 'add', 'clip-here-session', '--here'], 'clip-here-session').status, 1);
});

test('every adapter sessionEnv is cleared, so running the suite inside one agent cannot leak into another', () => {
  // The defect this guards: the helper used to clear only Claude Code's var,
  // so `npm test` inside kiro-cli or Codex ran with a real id inherited and
  // --here resolved that session instead of the one a test names.
  assert.deepEqual(SESSION_ENVS.slice().sort(), ADAPTERS.filter((a) => a.sessionEnv).map((a) => a.sessionEnv).sort());

  // Any adapter's var is a real input, not just Claude Code's: an id passed
  // through Kiro's must be *read* ("not in the store"), not ignored ("pass
  // the session id"). Those two errors are how we tell the difference.
  const viaKiro = runHere(['clip', 'add', '--here'], 'no-such-session-anywhere', 'KIRO_SESSION_ID');
  assert.equal(viaKiro.status, 1);
  assert.match(viaKiro.stderr, /not in the store/, 'KIRO_SESSION_ID must be read, not dropped');

  // And with nothing set at all, the suite must not pick up an id inherited
  // from whichever agent a contributor happens to be running it inside.
  const none = runHere(['clip', 'add', '--here']);
  assert.equal(none.status, 1);
  assert.match(none.stderr, /pass the session id/);
});

test('lastTurnsRange() with skipRequest ends before the request turn, so what the agent says after it is never pinned', () => {
  const turns = [
    { role: 'user', text: 'q' },
    { role: 'assistant', text: 'the answer' },
    { role: 'user', text: '$clip keep this' },
    { role: 'assistant', text: 'Sure, pinning it now.' },
  ];
  assert.deepEqual(lastTurnsRange(turns, 1, { skipRequest: true }), { ok: true, from: 2, to: 2 });
  assert.deepEqual(lastTurnsRange(turns, 2, { skipRequest: true }), { ok: true, from: 1, to: 2 });
  // without it (Claude Code: the request isn't a turn) the newest answer is it
  assert.deepEqual(lastTurnsRange(turns, 1), { ok: true, from: 4, to: 4 });
});

test('mycelium clip add --here --skip-request pins the answer before the request turn', () => {
  seed('clip-skip-session', 'here', ['q', 'the answer', '$clip', 'Pinning now.']);
  const res = runHere(['clip', 'add', '--here', '--last', '1', '--skip-request'], 'clip-skip-session');
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /turn 2 /);
  assert.match(res.stdout, /\[assistant\] the answer/);
});

test('recentAnswers() lists answers oldest first with the question each followed, up to the same end as --last', () => {
  const turns = ['q1', 'a1', 'q2', 'a2', '$clip pick', 'Listing them now.'].map((text, i) => ({ role: i % 2 ? 'assistant' : 'user', text }));
  assert.deepEqual(recentAnswers(turns, 10, { skipRequest: true }), [
    { turn: 2, question: 'q1', answer: 'a1' },
    { turn: 4, question: 'q2', answer: 'a2' },
  ]);
  assert.deepEqual(recentAnswers(turns, 1, { skipRequest: true }).map((a) => a.turn), [4]);
  assert.deepEqual(recentAnswers(turns).map((a) => a.turn), [2, 4, 6]);
  // narration between tool calls isn't listed, only each question's last answer
  const narrated = [
    { role: 'user', text: 'do it' },
    { role: 'assistant', text: 'Core first.' },
    { role: 'assistant', text: 'Now the CLI.' },
    { role: 'assistant', text: 'Done: all tests pass.' },
  ];
  assert.deepEqual(recentAnswers(narrated), [{ turn: 4, question: 'do it', answer: 'Done: all tests pass.' }]);
});

test('mycelium clip add --here --list prints numbered answers; --here --turn pins one with its note', () => {
  seed('clip-pick-session', 'here', ['first q', 'first answer', 'second q', 'second answer']);
  const list = runHere(['clip', 'add', '--here', '--list'], 'clip-pick-session');
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /^ {4}2 {2}Q: first q\n {7}A: first answer$/m);
  assert.match(list.stdout, /newest answer: --turn 4 .* --turn <5-N>-4/);
  assert.equal(listClips({ sessionId: 'clip-pick-session' }).length, 0, '--list pins nothing');

  const pin = runHere(['clip', 'add', '--here', '--turn', '2', '--note', "the first one's answer"], 'clip-pick-session');
  assert.equal(pin.status, 0, pin.stderr);
  assert.match(pin.stdout, /turn 2 .*\n {2}\[assistant\] first answer/);
  assert.equal(listClips({ sessionId: 'clip-pick-session' })[0].note, "the first one's answer");
  assert.match(runHere(['clip', 'add', '--here', '--turn', '1-4'], 'clip-pick-session').stdout, /turns 1-4/);
});
