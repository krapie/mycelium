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
  proc.stdin = { write: (l) => onLine(proc, JSON.parse(l)), end() {} };
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
