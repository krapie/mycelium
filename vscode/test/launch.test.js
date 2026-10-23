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
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { relatedTo, enqueue, claim, pending, withdraw, TTL } = require('../src/launch.js');
const claude = (dir) => claim(dir, ['/work/app']);

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mycelium-launch-'));
const L = (cwd) => ({ cwd, bin: 'claude', args: ['--resume', 'abc'], name: 'n', key: 'claude' });

test('relatedTo: the same project, in either direction; never a sibling that shares a prefix', () => {
  assert.equal(relatedTo('/work/app', ['/work/app']), true);
  assert.equal(relatedTo('/work/app/packages/web', ['/work/app']), true); // session ran in a subfolder
  assert.equal(relatedTo('/work/app', ['/work/app/packages/web']), true); // window is on a subfolder of it
  assert.equal(relatedTo('/work/application', ['/work/app']), false);
  assert.equal(relatedTo('/work/other', ['/work/app', '/work/lib']), false);
  assert.equal(relatedTo('/work/app', []), false);
});

test('relatedTo follows Windows rules when given path.win32: drive letters ignore case, both separators work', () => {
  const w = path.win32;
  assert.equal(relatedTo('C:\\Work\\App\\src', ['c:\\work\\app'], w), true);
  assert.equal(relatedTo('c:\\work\\app', ['C:\\Work\\App\\packages\\web'], w), true);
  assert.equal(relatedTo('C:\\work\\application', ['C:\\work\\app'], w), false);
  assert.equal(relatedTo('D:\\work\\app', ['C:\\work\\app'], w), false, 'another drive is another project');
  assert.equal(relatedTo('C:/work/app/src', ['C:\\work\\app'], w), true);
});

test('a window claims requests for its project, and claiming is the acknowledgement', () => {
  const dir = tmp();
  const file = enqueue(dir, L('/work/app'));
  assert.equal(pending(file), true);
  assert.deepEqual(claim(dir, ['/work/other']), [], 'another project leaves it alone');
  assert.equal(pending(file), true);
  const got = claim(dir, ['/work/app']);
  assert.equal(got.length, 1);
  assert.deepEqual([got[0].bin, got[0].args], ['claude', ['--resume', 'abc']]);
  assert.equal(pending(file), false, 'taken — the sender sees it vanish');
});

test('two windows on the same project cannot both start it', () => {
  const dir = tmp();
  enqueue(dir, L('/work/app'));
  assert.equal(claim(dir, ['/work/app']).length + claim(dir, ['/work/app']).length, 1);
});

test('stale requests are discarded instead of launching long after the click', () => {
  const dir = tmp();
  const now = Date.now();
  const file = enqueue(dir, L('/work/app'), now - TTL - 1000);
  assert.deepEqual(claim(dir, ['/work/app'], now), []);
  assert.equal(pending(file), false);
});

test('a half-written request is never read, and junk files are ignored', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'x.json.tmp'), '{"cwd":"/work/app"'); // mid-rename
  fs.writeFileSync(path.join(dir, 'junk.json'), 'not json');
  fs.writeFileSync(path.join(dir, 'wrong.json'), JSON.stringify({ cwd: 5 }));
  fs.writeFileSync(path.join(dir, 'oldformat.json'), JSON.stringify({ cwd: '/work/app', line: 'cd x && claude', created: Date.now() })); // a command line, not bin/args
  fs.writeFileSync(path.join(dir, 'badargs.json'), JSON.stringify({ cwd: '/work/app', bin: 'claude', args: ['ok', 5], created: Date.now() }));
  assert.deepEqual(claim(dir, ['/work/app']), []);
  assert.deepEqual(claim(path.join(dir, 'missing'), ['/work/app']), []);
});

test('the sender can withdraw an unclaimed request, but not one that was taken', () => {
  const dir = tmp();
  const a = enqueue(dir, L('/work/app'));
  assert.equal(withdraw(a), true);
  const b = enqueue(dir, L('/work/app'));
  claim(dir, ['/work/app']);
  assert.equal(withdraw(b), false);
});

test('a launch may ask for the Claude Code panel; the command line stays required as the fallback', () => {
  const dir = tmp();
  enqueue(dir, { ...L('/work/app'), panel: { sessionId: 'abc', prompt: 'hi' } });
  enqueue(dir, { ...L('/work/app'), panel: {} }); // a new conversation
  const got = claude(dir);
  // (readdir order is not the order they were queued in)
  assert.deepEqual(got.map((l) => JSON.stringify(l.panel)).sort(), ['{"sessionId":"abc","prompt":"hi"}', '{}']);
  // a panel request without the fallback command line is not a launch at all
  fs.writeFileSync(path.join(dir, 'nocmd.json'), JSON.stringify({ cwd: '/work/app', panel: { sessionId: 'x' }, created: Date.now() }));
  assert.deepEqual(claude(dir), []);
});

test('a malformed panel request is dropped rather than half-run', () => {
  const dir = tmp();
  for (const [i, panel] of [[1, 'x'], [2, { sessionId: 5 }], [3, { prompt: ['a'] }], [4, null]]) {
    fs.writeFileSync(path.join(dir, `bad${i}.json`), JSON.stringify({ ...L('/work/app'), panel, created: Date.now() }));
  }
  assert.deepEqual(claude(dir), []);
});

test('binMissing travels with a launch, and a non-boolean one is dropped', () => {
  const dir = tmp();
  enqueue(dir, { ...L('/work/app'), binMissing: true, panel: { sessionId: 'abc' } });
  const got = claude(dir);
  assert.equal(got.length, 1);
  assert.equal(got[0].binMissing, true);
  fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify({ ...L('/work/app'), binMissing: 'yes', created: Date.now() }));
  assert.deepEqual(claude(dir), []);
});
