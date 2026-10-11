'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { relatedTo, enqueue, claim, pending, withdraw, TTL } = require('../src/launch.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mycelium-launch-'));
const L = (cwd) => ({ cwd, line: `cd ${cwd} && claude`, name: 'n', key: 'claude' });

test('relatedTo: the same project, in either direction; never a sibling that shares a prefix', () => {
  assert.equal(relatedTo('/work/app', ['/work/app']), true);
  assert.equal(relatedTo('/work/app/packages/web', ['/work/app']), true); // session ran in a subfolder
  assert.equal(relatedTo('/work/app', ['/work/app/packages/web']), true); // window is on a subfolder of it
  assert.equal(relatedTo('/work/application', ['/work/app']), false);
  assert.equal(relatedTo('/work/other', ['/work/app', '/work/lib']), false);
  assert.equal(relatedTo('/work/app', []), false);
});

test('a window claims requests for its project, and claiming is the acknowledgement', () => {
  const dir = tmp();
  const file = enqueue(dir, L('/work/app'));
  assert.equal(pending(file), true);
  assert.deepEqual(claim(dir, ['/work/other']), [], 'another project leaves it alone');
  assert.equal(pending(file), true);
  const got = claim(dir, ['/work/app']);
  assert.equal(got.length, 1);
  assert.equal(got[0].line, 'cd /work/app && claude');
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
