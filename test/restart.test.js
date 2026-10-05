import test from 'node:test';
import assert from 'node:assert/strict';
import { relaunch } from '../src/tui/restart.js';

test('relaunch() re-execs the same argv and env (#146)', () => {
  const calls = [];
  const ok = relaunch({
    execve: (...args) => calls.push(args),
    platform: 'linux',
    execPath: '/usr/bin/node',
    argv: ['/usr/bin/node', '/opt/mycelium/src/cli.js', 'tui'],
    env: { A: '1' },
  });
  assert.equal(ok, true);
  assert.deepEqual(calls, [['/usr/bin/node', ['/usr/bin/node', '/opt/mycelium/src/cli.js', 'tui'], { A: '1' }]]);
});

test('relaunch() reports false where execve is unavailable, so the caller quits instead', () => {
  assert.equal(relaunch({ execve: null, platform: 'linux' }), false);
  assert.equal(relaunch({ execve: () => {}, platform: 'win32' }), false);
});
