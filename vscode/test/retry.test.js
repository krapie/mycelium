'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { withWiderPath } = require('../src/retry.js');
const { Client } = require('../src/client.js');

const fails = (message) => { const e = new Error(message); return e; };

test('a result is returned without ever widening the PATH', async () => {
  let widened = 0;
  assert.equal(await withWiderPath(async () => 42, async () => (widened++, true)), 42);
  assert.equal(widened, 0);
});

test('"<bin> not installed" widens the PATH once and asks again', async () => {
  let calls = 0;
  const logged = [];
  const result = await withWiderPath(async () => { if (++calls === 1) throw fails('claude not installed'); return 'found'; }, async () => true, (l) => logged.push(l));
  assert.equal(result, 'found');
  assert.equal(calls, 2);
  assert.match(logged[0], /claude not installed.*login shell/);
});

test('when the login shell has nothing to add, the original error is thrown and nothing is retried', async () => {
  let calls = 0;
  await assert.rejects(withWiderPath(async () => { calls++; throw fails('claude not installed'); }, async () => false), /claude not installed/);
  assert.equal(calls, 1);
});

test('a second failure is not retried again, and other errors are never retried', async () => {
  let calls = 0;
  await assert.rejects(withWiderPath(async () => { calls++; throw fails('claude not installed'); }, async () => true), /claude not installed/);
  assert.equal(calls, 2);

  calls = 0;
  let widened = 0;
  await assert.rejects(withWiderPath(async () => { calls++; throw fails('no working directory found'); }, async () => (widened++, true)), /no working directory/);
  assert.deepEqual([calls, widened], [1, 0]);
});

test('Client.reset() drops the resolution and the child, so the next request resolves and spawns again — and the old child\'s late exit does not fail it', async () => {
  let asked = 0;
  let spawns = 0;
  const killed = [];
  const c = new Client({
    resolver: async () => (asked++, { command: 'x', env: {} }),
    spawnFn: () => {
      spawns++;
      const p = new EventEmitter();
      p.stdout = new EventEmitter(); p.stderr = new EventEmitter();
      // a real child needs a moment to start and answer — longer than the old one takes to report its exit
      p.stdin = Object.assign(new EventEmitter(), { write: (l) => { const r = JSON.parse(l); setTimeout(() => p.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', id: r.id, result: 'ok' }) + '\n'), 30); }, end() {} });
      // a killed process reports its exit later, after the next one may already be busy
      p.kill = () => { killed.push(spawns); setImmediate(() => p.emit('close', null)); };
      return p;
    },
  });
  assert.equal(await c.request('a'), 'ok');
  c.reset();
  assert.equal(await c.request('b'), 'ok');
  assert.deepEqual([asked, spawns, killed.length], [2, 2, 1]);
});
