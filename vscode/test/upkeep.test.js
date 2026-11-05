/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const fake = {
  EventEmitter: class { constructor() { this.event = () => {}; } fire() {} },
  ThemeIcon: class {}, ThemeColor: class {}, env: { language: 'en', shell: '/bin/zsh' },
  workspace: { getConfiguration: () => ({ get: () => undefined }) },
  window: {},
};
const orig = Module._load;
Module._load = function (request, ...rest) { return request === 'vscode' ? fake : orig.call(this, request, ...rest); };
const { upkeepDecision, readyCount, isOldCli, describeStatus } = require('../src/upkeep.js');
const { strings } = require('../src/i18n.js');
const { visible } = require('../src/actions.js');
Module._load = orig;

test('"on" starts the daemon every time; "off" never touches it', () => {
  assert.equal(upkeepDecision({ setting: 'on', asked: false }), 'start');
  assert.equal(upkeepDecision({ setting: 'on', asked: true }), 'start');
  assert.equal(upkeepDecision({ setting: 'off', asked: false }), 'none');
});

test('"ask" asks exactly once, then stays quiet', () => {
  assert.equal(upkeepDecision({ setting: 'ask', asked: false }), 'ask');
  assert.equal(upkeepDecision({ setting: 'ask', asked: true }), 'none');
});

test('readyCount adds suggestions and knowledge updates, and tolerates no status', () => {
  assert.equal(readyCount({ suggestions: 3, knowledge: 2 }), 5);
  assert.equal(readyCount({ running: true }), 0);
  assert.equal(readyCount(null), 0);
});

test('only an "unknown method" error means the CLI is too old', () => {
  assert.equal(isOldCli(new Error('unknown method: upkeepStatus')), true);
  assert.equal(isOldCli(new Error('boom')), false);
  assert.equal(isOldCli(undefined), false);
});

test('while upkeep runs, scan and summarize are not offered as chores', () => {
  const on = { pending: 0, upkeep: true };
  const off = { pending: 0, upkeep: false };
  assert.equal(visible('scan', on), false);
  assert.equal(visible('summarize', on), false);
  assert.equal(visible('scan', off), true);
  assert.equal(visible('runAll', on), true);
  assert.equal(visible('organize', on), true);
});

test('review shows only with something waiting; calendar only when enabled', () => {
  assert.equal(visible('review', { pending: 0 }), false);
  assert.equal(visible('review', { pending: 2 }), true);
  assert.equal(visible('calendar', {}, false), false);
  assert.equal(visible('calendar', {}, true), true);
});

test('describeStatus says whether the daemon runs, which process, and what is queued', () => {
  const t = strings('en');
  assert.equal(describeStatus(null, t), 'Status unavailable');
  assert.equal(describeStatus({ running: false }, t), 'Not running');
  assert.equal(describeStatus({ running: true, pid: 42, version: '0.5.6', suggestions: 0, knowledge: 0 }, t), 'Running (pid 42, v0.5.6) · nothing waiting for review');
  assert.equal(describeStatus({ running: true, pid: 42, suggestions: 2, knowledge: 1 }, t), 'Running (pid 42) · 2 sessions ready to file · 1 knowledge update');
  assert.match(describeStatus({ running: true, pid: 7, version: '1', suggestions: 1, knowledge: 0 }, strings('ko')), /^실행 중 \(pid 7, v1\)/);
});
