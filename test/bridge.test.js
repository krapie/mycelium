import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers.js';

const home = useTempHome();
const { saveRaw } = await import('../src/scanner.js');
const { emptyNeutral } = await import('../src/schema.js');
const { handle, PROTOCOL } = await import('../src/bridge.js');
const { reindex } = await import('../src/index-db.js');

const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const call = (method, params) => handle({ jsonrpc: '2.0', id: 1, method, params });

function seed(id, text) {
  const n = emptyNeutral(id, 'claude-code');
  n.startedAt = '2026-01-01T00:00:00Z';
  n.turns = [{ role: 'user', text }, { role: 'assistant', text: 'done' }];
  saveRaw(n);
  return n;
}

seed('aaaaaaaa-1111', 'fix the login bug');
seed('bbbbbbbb-2222', 'write the release notes');
reindex();

test('hello reports protocol and version', async () => {
  const { result } = await call('hello');
  assert.equal(result.protocol, PROTOCOL);
  assert.ok(result.version);
});

test('sessions lists, detail omits turns and accepts an id prefix', async () => {
  assert.equal((await call('sessions', {})).result.length, 2);
  const d = (await call('detail', { id: 'aaaaaaaa' })).result;
  assert.equal(d.id, 'aaaaaaaa-1111');
  assert.equal(d.turnCount, 2);
  assert.equal(d.turns, undefined);
});

test('move and tag write through and refresh the index', async () => {
  await call('mkdir', { folder: 'Projects/x' });
  assert.equal((await call('move', { ids: ['aaaaaaaa-1111'], folder: 'Projects/x' })).result.moved, 1);
  assert.equal((await call('sessions', { folder: 'Projects/x' })).result.length, 1);
  await call('tag', { ids: ['aaaaaaaa-1111'], add: ['bug'] });
  const tags = (await call('tags')).result;
  assert.ok(tags.some((t) => t.name === 'bug'));
  const f = (await call('folders')).result;
  assert.equal(f.counts['Projects/x'], 1);
});

test('failures come back as JSON-RPC errors, not throws', async () => {
  assert.equal((await call('detail', { id: 'nope' })).error.code, -32000);
  assert.equal((await call('mkdir', { folder: '../escape' })).error.code, -32000);
  assert.equal((await call('nosuch')).error.code, -32601);
  assert.equal((await handle({ id: 3 })).error.code, -32600);
  assert.equal(await handle({ jsonrpc: '2.0', method: 'hello' }), null); // notification: no reply
});

test('handoff builds a prompt for a session', async () => {
  const { result } = await call('handoff', { id: 'bbbbbbbb' });
  assert.match(result.prompt, /release notes/);
});

test('serve --stdio answers over a real pipe and keeps stdout pure JSON', async () => {
  const child = spawn(process.execPath, [cliPath, 'serve', '--stdio'], { env: { ...process.env, MYCELIUM_HOME: home } });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"hello"}\nnot json\n{"jsonrpc":"2.0","id":2,"method":"sessions","params":{}}\n');
  child.stdin.end();
  await new Promise((r) => child.on('close', r));
  const lines = out.trim().split('\n').map((l) => JSON.parse(l)); // throws on any non-JSON line
  assert.equal(lines.length, 3);
  assert.equal(lines[0].result.protocol, PROTOCOL);
  assert.equal(lines[1].error.code, -32700);
  assert.equal(lines[2].result.length, 2);
});

test('sessions({dir}) keeps only sessions that ran in or below that directory', async () => {
  const mk = (id, dir) => {
    const n = seed(id, 'task in ' + dir);
    n.projectDir = dir;
    saveRaw(n);
  };
  mk('cccccccc-3333', '/work/app');
  mk('dddddddd-4444', '/work/app/packages/web');
  mk('eeeeeeee-5555', '/work/application'); // shares a string prefix, is not a child
  reindex();
  const ids = (await call('sessions', { dir: '/work/app' })).result.map((r) => r.id).sort();
  assert.deepEqual(ids, ['cccccccc-3333', 'dddddddd-4444']);
  assert.equal((await call('sessions', { dir: '/work/app/' })).result.length, 2); // trailing slash tolerated
});

test('folders marks which carry a KNOWLEDGE.md; detail resolves lineage', async () => {
  const { writeKnowledgeText } = await import('../src/insight/knowledge.js');
  writeKnowledgeText('Projects/x', '## notes');
  const f = (await call('folders')).result;
  assert.ok(f.knowledge.includes('Projects/x'));

  const child = seed('ffffffff-6666', 'continue it');
  child.continuationOf = 'bbbbbbbb-2222';
  saveRaw(child);
  const d = (await call('detail', { id: 'ffffffff' })).result;
  assert.equal(d.lineage.continuationOf[0].id, 'bbbbbbbb-2222');
  assert.deepEqual(d.lineage.mergedFrom, []);
});
