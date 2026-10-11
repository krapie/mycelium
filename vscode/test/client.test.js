'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Client } = require('../src/client.js');
const { transcriptMarkdown } = require('../src/markdown.js');

function fakeChild(onLine) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = Object.assign(new EventEmitter(), { write: (l) => onLine(proc, JSON.parse(l)), end() {} });
  proc.kill = () => proc.emit('close', 0);
  return proc;
}
const reply = (proc, id, body) => proc.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', id, ...body }) + '\n');

test('matches responses to requests, even split across chunks and out of order', async () => {
  const held = [];
  const c = new Client({ spawnFn: () => fakeChild((p, req) => held.push([p, req])) });
  const a = c.request('a');
  const b = c.request('b');
  const [p, rb] = held[1];
  const line = JSON.stringify({ jsonrpc: '2.0', id: rb.id, result: 'B' }) + '\n';
  p.stdout.emit('data', line.slice(0, 5));
  p.stdout.emit('data', line.slice(5));
  reply(held[0][0], held[0][1].id, { result: 'A' });
  assert.deepEqual([await a, await b], ['A', 'B']);
});

test('error responses reject with the message and code', async () => {
  const c = new Client({ spawnFn: () => fakeChild((p, r) => reply(p, r.id, { error: { code: -32000, message: 'no session x' } })) });
  await assert.rejects(c.request('detail'), (e) => e.message === 'no session x' && e.code === -32000);
});

test('a dead child fails pending calls and the next request restarts it', async () => {
  let spawns = 0;
  const c = new Client({
    spawnFn: () =>
      fakeChild((p, r) => {
        spawns++;
        if (spawns === 1) p.emit('close', 1);
        else reply(p, r.id, { result: 'ok' });
      }),
  });
  await assert.rejects(c.request('x'), /exited/);
  assert.equal(await c.request('x'), 'ok');
  assert.equal(spawns, 2);
});

test('a missing CLI surfaces as ENOENT', async () => {
  const c = new Client({
    spawnFn: () => {
      const p = fakeChild(() => {});
      setImmediate(() => p.emit('error', Object.assign(new Error('spawn'), { code: 'ENOENT' })));
      return p;
    },
  });
  await assert.rejects(c.request('x'), (e) => e.code === 'ENOENT');
});

test('times out when the server never answers', async () => {
  const c = new Client({ timeoutMs: 20, spawnFn: () => fakeChild(() => {}) });
  await assert.rejects(c.request('slow'), /timed out/);
});

test('progress notifications reach only the call that asked, and a progress call has no timeout', async () => {
  let proc;
  const c = new Client({ timeoutMs: 20, spawnFn: () => (proc = fakeChild((p, r) => (p.last = r))) });
  const seen = [];
  const long = c.request('autotag', { limit: 5 }, { onProgress: (i) => seen.push(i.done) });
  assert.match(proc.last.params.token || '', /^t/);
  const token = proc.last.params.token;
  const other = c.request('folders');
  other.catch(() => {}); // times out below; not what this test is about
  proc.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', method: 'progress', params: { token, done: 1 } }) + '\n');
  proc.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', method: 'progress', params: { token: 'nope', done: 9 } }) + '\n');
  await new Promise((r) => setTimeout(r, 40)); // past the 20ms timeout the plain call hit
  proc.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', method: 'progress', params: { token, done: 2 } }) + '\n');
  proc.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tagged: 2 } }) + '\n');
  assert.deepEqual(await long, { tagged: 2 });
  assert.deepEqual(seen, [1, 2]);
});

test('a CLI that exits cleanly without ever answering is reported as too old, not as a mystery exit', async () => {
  const c = new Client({ spawnFn: () => fakeChild((p) => p.emit('close', 0)) });
  await assert.rejects(c.request('hello'), (e) => e.code === 'OLD_CLI' && /0\.5\.0/.test(e.message) && /npm install -g/.test(e.message));
});

test('a clean exit AFTER answering is not "too old"', async () => {
  const c = new Client({ spawnFn: () => fakeChild((p, r) => { reply(p, r.id, { result: 1 }); p.emit('close', 0); }) });
  assert.equal(await c.request('hello'), 1);
});

test('on Windows the CLI is run through a shell, with a spaced path quoted; elsewhere it is not', async () => {
  const seen = [];
  const mk = (platform, command) => new Client({ platform, command, spawnFn: (cmd, args, opts) => { seen.push({ cmd, args, shell: opts.shell, windowsHide: opts.windowsHide }); return fakeChild((p, r) => reply(p, r.id, { result: 1 })); } });
  await mk('win32', 'C:\\Program Files\\nodejs\\mycelium.cmd').request('x');
  await mk('win32', 'mycelium').request('x');
  await mk('darwin', '/opt/homebrew/bin/my cel').request('x');
  assert.deepEqual(seen.map((s) => [s.cmd, s.shell]), [['"C:\\Program Files\\nodejs\\mycelium.cmd"', true], ['mycelium', true], ['/opt/homebrew/bin/my cel', false]]);
  assert.ok(seen.every((s) => s.args.join(' ') === 'serve --stdio' && s.windowsHide === true));
});

test('a write that fails because the child just exited fails the call instead of crashing the host', async () => {
  let child;
  const c = new Client({ spawnFn: () => (child = fakeChild(() => {})) });
  const p = c.request('hello');
  child.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })); // would be an uncaught exception with no listener
  await assert.rejects(p, /EPIPE/);
  // and the next request starts a fresh child
  const c2 = new Client({ spawnFn: () => fakeChild((q, r) => reply(q, r.id, { result: 'ok' })) });
  assert.equal(await c2.request('hello'), 'ok');
});

test('transcriptMarkdown labels turns and truncates a huge one', () => {
  const md = transcriptMarkdown({
    id: 'abc', extracted: { title: 'Fix login' },
    turns: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'x'.repeat(5000) }],
  });
  assert.match(md, /^# Fix login/);
  assert.match(md, /### You\n\nhi/);
  assert.match(md, /### Assistant/);
  assert.match(md, /… \(1000 more characters\)/);
});
