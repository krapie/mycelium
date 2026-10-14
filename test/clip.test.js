import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers.js';

const home = useTempHome();

const { createClip, listClips, findClip, deleteClip, clipFolder } = await import('../src/clip.js');
const { saveRaw, loadRaw } = await import('../src/scanner.js');
const { emptyNeutral } = await import('../src/schema.js');
const { createBacklog } = await import('../src/backlog.js');
const { deleteSession, move } = await import('../src/organize.js');
const { buildKnowledgeText } = await import('../src/insight.js');
const { __setTestProvider, __clearTestProvider } = await import('../src/llm.js');

test.afterEach(() => __clearTestProvider());

const CLI_PATH = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const runCli = (args) => spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: 'utf8', env: { ...process.env, MYCELIUM_HOME: home } });

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
