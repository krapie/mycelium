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
import { EventEmitter } from 'node:events';
import { useTempHome } from './helpers.js';

useTempHome();

const { installShutdownHandlers } = await import('../src/daemon/process.js');
const { __trackChildForTest, __clearInFlightForTest } = await import('../src/llm.js');

test('the standalone daemon kills in-flight LLM children on SIGTERM before exiting (#139)', () => {
  const proc = new EventEmitter();
  const exits = [];
  const killed = [];
  __trackChildForTest({ kill: (sig) => killed.push(sig) });
  try {
    installShutdownHandlers(proc, (code) => exits.push(code));
    proc.emit('SIGTERM');
    assert.deepEqual(killed, ['SIGTERM']);
    assert.deepEqual(exits, [0]);
  } finally {
    __clearInFlightForTest();
  }
});

const { spawnDetachedDaemon, stopDetachedDaemon, handOverToFreshDaemon } = await import('../src/daemon/process.js');
const { upgradedOnDisk } = await import('../src/daemon/cycles.js');
const { DAEMON_PID_PATH, DAEMON_VERSION_PATH } = await import('../src/paths.js');
const { VERSION, installedVersion } = await import('../src/version.js');
const { writeFileSync, readFileSync, existsSync, rmSync } = await import('node:fs');

test('upgradedOnDisk ignores an unreadable package.json and detects a different version (#203)', () => {
  assert.equal(upgradedOnDisk('1.0.0', null), false);
  assert.equal(upgradedOnDisk('1.0.0', '1.0.0'), false);
  assert.equal(upgradedOnDisk('1.0.0', '1.0.1'), true);
  assert.equal(installedVersion(), VERSION);
});

test('--detach leaves a same-version daemon alone and replaces an older or untracked one (#203)', () => {
  try {
    writeFileSync(DAEMON_PID_PATH, String(process.pid));
    writeFileSync(DAEMON_VERSION_PATH, VERSION);
    assert.deepEqual(spawnDetachedDaemon({ kill: () => assert.fail('must not kill') }), { started: false, pid: process.pid });

    // No version file: the daemon predates tracking, so it is stale. The kill
    // seam stands in for stopDetachedDaemon() so the test process survives.
    rmSync(DAEMON_VERSION_PATH);
    let killed = 0;
    const res = spawnDetachedDaemon({ kill: () => killed++ });
    assert.equal(killed, 1);
    assert.equal(res.restarted, true);
    assert.equal(res.from, 'unknown');
    process.kill(res.pid); // the real detached child it spawned
    assert.equal(readFileSync(DAEMON_VERSION_PATH, 'utf8'), VERSION);
  } finally {
    stopDetachedDaemon();
  }
});

test('stopDetachedDaemon removes the version file', () => {
  writeFileSync(DAEMON_PID_PATH, '999999');
  writeFileSync(DAEMON_VERSION_PATH, VERSION);
  stopDetachedDaemon();
  assert.equal(existsSync(DAEMON_VERSION_PATH), false);
});

test('a daemon that owns the pidfile launches a replacement before exiting; a supervised one only exits (#203)', () => {
  const calls = [];
  const proc = { pid: 4242, exit: (c) => calls.push(`exit${c}`) };
  try {
    writeFileSync(DAEMON_PID_PATH, '4242');
    handOverToFreshDaemon(proc, { launch: () => calls.push('launch') });
    assert.deepEqual(calls, ['launch', 'exit0']);

    calls.length = 0;
    writeFileSync(DAEMON_PID_PATH, '1');
    handOverToFreshDaemon(proc, { launch: () => calls.push('launch') });
    rmSync(DAEMON_PID_PATH);
    handOverToFreshDaemon(proc, { launch: () => calls.push('launch') });
    assert.deepEqual(calls, ['exit0', 'exit0']);
  } finally {
    rmSync(DAEMON_PID_PATH, { force: true });
  }
});
