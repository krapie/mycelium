'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { withWiderPath } = require('../src/retry.js');
const { Client } = require('../src/client.js');

const fails = (message) => new Error(message);

test('a result is returned without ever asking the login shell', async () => {
  let asked = 0;
  assert.equal(await withWiderPath(async () => 42, async () => (asked++, ['/x'])), 42);
  assert.equal(asked, 0);
});

test('"<bin> not installed" asks for the login shell\'s directories once and calls again with them', async () => {
  const seen = [];
  const logged = [];
  const result = await withWiderPath(async (dirs) => { seen.push(dirs); if (!dirs) throw fails('claude not installed'); return 'found'; }, async () => ['/Users/me/.claude/local'], (l) => logged.push(l));
  assert.equal(result, 'found');
  assert.deepEqual(seen, [undefined, ['/Users/me/.claude/local']]);
  assert.match(logged[0], /claude not installed.*login shell/);
});

test('when the login shell has nothing to add, the original error is thrown and nothing is retried', async () => {
  for (const none of [[], undefined, null]) {
    let calls = 0;
    await assert.rejects(withWiderPath(async () => { calls++; throw fails('claude not installed'); }, async () => none), /claude not installed/);
    assert.equal(calls, 1);
  }
});

test('a second failure is not retried again, and other errors are never retried', async () => {
  let calls = 0;
  await assert.rejects(withWiderPath(async () => { calls++; throw fails('claude not installed'); }, async () => ['/x']), /claude not installed/);
  assert.equal(calls, 2);

  calls = 0;
  let asked = 0;
  await assert.rejects(withWiderPath(async () => { calls++; throw fails('no working directory found'); }, async () => (asked++, ['/x'])), /no working directory/);
  assert.deepEqual([calls, asked], [1, 0]);
});

// A child that has been replaced (it died and a new request started another)
// reports late, after its successor may be busy: neither its exit nor its
// output may touch the successor's requests.
function child(onWrite) {
  const p = new EventEmitter();
  p.stdout = new EventEmitter();
  p.stderr = new EventEmitter();
  p.stdin = Object.assign(new EventEmitter(), { write: (l) => onWrite(p, JSON.parse(l)), end() {} });
  p.kill = () => {};
  return p;
}

test('the late exit of a replaced child does not fail the request its successor is answering', async () => {
  const kids = [];
  const c = new Client({
    spawnFn: () => {
      const n = kids.length;
      const p = child((q, r) => { if (n === 1) setTimeout(() => q.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', id: r.id, result: 'ok' }) + '\n'), 30); });
      kids.push(p);
      return p;
    },
  });
  const first = c.request('a');
  kids[0].emit('close', 1); // the first child dies
  await assert.rejects(first, /exited/);
  const second = c.request('b'); // spawns the next child, which takes a moment to answer
  setImmediate(() => kids[0].emit('close', null)); // ...and the dead one reports again
  assert.equal(await second, 'ok');
});

test('output from a replaced child never reaches the successor\'s line buffer', async () => {
  const kids = [];
  const c = new Client({
    spawnFn: () => {
      const n = kids.length;
      const p = child((q, r) => { if (n === 1) setTimeout(() => q.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', id: r.id, result: 'clean' }) + '\n'), 30); });
      kids.push(p);
      return p;
    },
  });
  const first = c.request('a');
  kids[0].emit('close', 1);
  await assert.rejects(first, /exited/);
  const second = c.request('b');
  kids[0].stdout.emit('data', '{"jsonrpc":"2.0","id":99,"res'); // a partial line from the dead child
  assert.equal(await second, 'clean');
});
