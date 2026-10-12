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

test('agents lists only what is on PATH by default, and every agent with onPath when asked', async () => {
  const prev = process.env.PATH;
  process.env.PATH = '';
  try {
    assert.deepEqual((await call('agents')).result, []);
    const all = (await call('agents', { all: true })).result;
    assert.ok(all.length >= 3);
    assert.ok(all.every((a) => a.onPath === false && a.key && a.label && a.bin));
    assert.ok(all.some((a) => a.key === 'claude'));
  } finally {
    process.env.PATH = prev;
  }
});

test('resumeCommand and newCommand can be told to accept an agent that is not on PATH', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-bin-'));
  const n = seed('eeeeeeee-0000', 'resume me');
  n.projectDir = dir;
  saveRaw(n);
  reindex();
  const prev = process.env.PATH;
  process.env.PATH = '';
  try {
    // refused by default, as before
    assert.equal((await call('newCommand', { agentKey: 'claude', dir })).error.message, 'claude not installed');
    // accepted when the caller has another way to run it
    const res = (await call('newCommand', { agentKey: 'claude', dir, allowMissingBin: true })).result;
    assert.equal(res.binMissing, true);
    assert.equal(res.cwd, dir);
    // resumeCommand likewise (this seed's source has no adapter, so the "agent still has it" check passes)
    assert.equal((await call('resumeCommand', { id: 'eeeeeeee-0000' })).error.message, 'claude not installed');
    const resumed = (await call('resumeCommand', { id: 'eeeeeeee-0000', allowMissingBin: true })).result;
    assert.deepEqual([resumed.binMissing, resumed.cwd, resumed.args], [true, dir, ['--resume', 'eeeeeeee-0000']]);
  } finally {
    process.env.PATH = prev;
  }
});

test('extraPath lets agents, resumeCommand and newCommand look for an agent in directories the CLI was not started with', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-extra-'));
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\n', { mode: 0o755 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-extra-cwd-'));
  const n = seed('eeeeeeee-1111', 'x');
  n.projectDir = dir;
  saveRaw(n);
  reindex();
  const prev = process.env.PATH;
  process.env.PATH = '';
  try {
    assert.equal((await call('agents', { all: true })).result.find((a) => a.key === 'claude').onPath, false);
    assert.equal((await call('agents', { all: true, extraPath: [bin] })).result.find((a) => a.key === 'claude').onPath, true);
    assert.equal((await call('newCommand', { agentKey: 'claude', dir })).error.message, 'claude not installed');
    assert.equal((await call('newCommand', { agentKey: 'claude', dir, extraPath: [bin] })).result.binMissing, undefined);
    assert.equal((await call('resumeCommand', { id: 'eeeeeeee-1111', extraPath: [bin] })).result.cwd, dir);
    // junk is ignored rather than trusted
    assert.equal((await call('newCommand', { agentKey: 'claude', dir, extraPath: 'nope' })).error.message, 'claude not installed');
    assert.equal((await call('newCommand', { agentKey: 'claude', dir, extraPath: [bin, 5] })).error.message, 'claude not installed');
  } finally {
    process.env.PATH = prev;
  }
});
