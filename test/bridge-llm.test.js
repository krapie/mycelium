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
import { useTempHome } from './helpers.js';

useTempHome();
const { saveRaw, loadRaw } = await import('../src/scanner.js');
const { emptyNeutral } = await import('../src/schema.js');
const { __setTestProvider, __clearTestProvider } = await import('../src/llm.js');
const { handle, LONG } = await import('../src/bridge.js');
const { reindex } = await import('../src/index-db.js');

test.afterEach(() => __clearTestProvider());

const sent = [];
const ctx = { notify: (method, params) => sent.push({ method, params }) };
const call = (method, params) => handle({ jsonrpc: '2.0', id: 1, method, params }, ctx);

function seed(id, over = {}) {
  const n = { ...emptyNeutral(id, 'claude'), startedAt: '2026-02-01T00:00:00Z', turns: [{ role: 'user', text: `work on ${id}` }, { role: 'assistant', text: 'ok' }], ...over };
  saveRaw(n);
  return n;
}

test('the LLM-backed methods are the ones serve.js runs outside its queue', () => {
  assert.deepEqual([...LONG].sort(), ['autotag', 'knowledgeBuild', 'knowledgePropose', 'organizeSuggest']);
});

test('upkeepStatus counts what the daemon queued and sees a live pidfile', async () => {
  const { writePendingKnowledgeText } = await import('../src/insight.js');
  const { queueSuggestions, clearSuggestions } = await import('../src/organize.js');
  const { dismissPendingKnowledge } = await import('../src/insight.js');
  const { DAEMON_PID_PATH, DAEMON_VERSION_PATH, ensureDirs } = await import('../src/paths.js');
  const { writeFileSync, rmSync } = await import('node:fs');
  ensureDirs();

  const idle = (await call('upkeepStatus')).result;
  assert.equal(idle.running, false);
  assert.equal(idle.suggestions, 0);

  seed('up-1');
  queueSuggestions([{ id: 'up-1', folder: 'Up/area', reason: 'r' }]);
  writePendingKnowledgeText('Up/area', 'proposed');
  // This test process stands in for a live daemon.
  writeFileSync(DAEMON_PID_PATH, String(process.pid));
  writeFileSync(DAEMON_VERSION_PATH, '9.9.9');
  try {
    const s = (await call('upkeepStatus')).result;
    assert.deepEqual({ running: s.running, pid: s.pid, version: s.version, suggestions: s.suggestions, knowledge: s.knowledge }, { running: true, pid: process.pid, version: '9.9.9', suggestions: 1, knowledge: 1 });
  } finally {
    rmSync(DAEMON_PID_PATH, { force: true });
    rmSync(DAEMON_VERSION_PATH, { force: true });
    clearSuggestions(['up-1']); // a queued suggestion would be reused by the organizeSuggest test below
    dismissPendingKnowledge('Up/area');
  }
});

test('upkeepStatus treats a stale pidfile as not running', async () => {
  const { DAEMON_PID_PATH, ensureDirs } = await import('../src/paths.js');
  const { writeFileSync, rmSync } = await import('node:fs');
  ensureDirs();
  writeFileSync(DAEMON_PID_PATH, '2147483646');
  try {
    assert.equal((await call('upkeepStatus')).result.running, false);
  } finally {
    rmSync(DAEMON_PID_PATH, { force: true });
  }
});

test('knowledgePropose stages a proposal for folders active that day', async () => {
  const { pendingKnowledgeReviews } = await import('../src/insight.js');
  seed('kp-1', { folder: 'kp-folder', startedAt: '2026-03-05T10:00:00.000Z' });
  __setTestProvider(async () => 'generated knowledge text');
  const res = (await call('knowledgePropose', { date: '2026-03-05' })).result;
  assert.deepEqual(res, { proposed: 1, failed: 0 });
  assert.ok(pendingKnowledgeReviews().some((r) => r.folder === 'kp-folder'));
  await call('knowledgeDismiss', { folder: 'kp-folder' });
});

test('autotag with ids summarizes those sessions and reports progress under the caller token', async () => {
  seed('at-1');
  seed('at-2');
  __setTestProvider(async () => JSON.stringify({ title: 'Fix it', tags: ['bug'], summary: 'fixed', decisions: [], todos: [] }));
  sent.length = 0;
  const { result } = await call('autotag', { ids: ['at-1', 'at-2'], token: 'tok-1' });
  assert.deepEqual(result, { tagged: 2, failed: 0 });
  assert.equal(loadRaw('at-1').extracted.title, 'Fix it');
  const progress = sent.filter((m) => m.method === 'progress');
  assert.equal(progress.length, 2);
  assert.deepEqual(progress.at(-1).params, { token: 'tok-1', done: 2, total: 2 });
});

test('organizeSuggest returns a reviewable list and organizeApply files only what was accepted', async () => {
  await call('mkdir', { folder: 'Work/api' }); // a folder that really exists, as move() would have made it
  seed('org-filed', { folder: 'Work/api', organizedBy: 'human', extracted: { ...emptyNeutral('x', 'claude').extracted, summary: 'REST api work' } });
  seed('org-a', { extracted: { ...emptyNeutral('x', 'claude').extracted, title: 'Add endpoint', summary: 'adds an endpoint' } });
  seed('org-b', { extracted: { ...emptyNeutral('x', 'claude').extracted, title: 'Tweak', summary: 'misc' } });
  reindex();
  __setTestProvider(async () =>
    JSON.stringify({
      placements: [
        { id: 'org-a', folder: 'Work/api', reason: 'api work' },
        { id: 'org-b', folder: 'Brand/new', reason: 'new topic' },
      ],
    }),
  );

  const { result: list } = await call('organizeSuggest', { limit: 10 });
  const a = list.find((x) => x.id === 'org-a');
  const b = list.find((x) => x.id === 'org-b');
  assert.equal(a.title, 'Add endpoint');
  assert.equal(a.newFolder, false);
  assert.equal(b.newFolder, true);

  const { result } = await call('organizeApply', { accept: [{ id: 'org-a', folder: 'Work/api' }], reject: ['org-b'] });
  assert.equal(result.applied, 1);
  assert.equal(loadRaw('org-a').folder, 'Work/api');
  assert.equal(loadRaw('org-a').organizedBy, 'human');
  assert.equal(loadRaw('org-b').folder, null);
  assert.equal(loadRaw('org-b').suggestedFolder, null, 'a rejected suggestion stops being offered');
});

test('organizeApply refuses an unsafe folder path', async () => {
  const { error } = await call('organizeApply', { accept: [{ id: 'org-a', folder: '../escape' }] });
  assert.equal(error.code, -32000);
});

test('knowledgeBuild proposes text next to the current file; knowledgeSave writes it', async () => {
  seed('kn-1', { folder: 'KB/area', extracted: { ...emptyNeutral('x', 'claude').extracted, summary: 'chose postgres', decisions: ['use postgres'] } });
  __setTestProvider(async () => '## Area\n\n- use postgres');
  const built = (await call('knowledgeBuild', { folder: 'KB/area' })).result;
  assert.match(built.text, /use postgres/);
  assert.equal(built.current, '');

  await call('knowledgeSave', { folder: 'KB/area', text: built.text });
  const again = (await call('knowledgeBuild', { folder: 'KB/area' })).result;
  assert.equal(again.current, built.text);
  assert.ok((await call('folders')).result.knowledge.includes('KB/area'));
  assert.equal((await call('knowledgeSave', { folder: 'KB/area', text: '  ' })).error.code, -32000);
});

test('pending knowledge can be listed, promoted and dismissed', async () => {
  const { writePendingKnowledgeText } = await import('../src/insight.js');
  writePendingKnowledgeText('KB/pending', 'proposed');
  const pending = (await call('knowledgePending')).result;
  assert.equal(pending.find((p) => p.folder === 'KB/pending').text, 'proposed');
  await call('knowledgePromote', { folder: 'KB/pending' });
  assert.equal((await call('knowledgePending')).result.some((p) => p.folder === 'KB/pending'), false);
  assert.equal((await call('knowledgePromote', { folder: 'KB/pending' })).error.code, -32000);
});

test('an LLM step fails fast with "<bin> not installed" when the agent is not on PATH, and extraPath finds it', { skip: process.platform === 'win32' }, async (t) => {
  const { mkdtempSync, writeFileSync, chmodSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'mycelium-fake-agent-'));
  const savedPath = process.env.PATH;
  t.after(() => {
    process.env.PATH = savedPath;
    rmSync(dir, { recursive: true, force: true });
  });
  // Stub `claude` that answers every call with a valid summary.
  const reply = JSON.stringify({ result: JSON.stringify({ title: 'Stub', tags: [], summary: 'from stub', decisions: [], todos: [] }) });
  writeFileSync(join(dir, 'claude'), `#!/bin/sh\necho '${reply}'\n`);
  chmodSync(join(dir, 'claude'), 0o755);
  process.env.PATH = '/nonexistent-mycelium-dir';
  seed('np-1');
  __clearTestProvider();

  const missing = await call('autotag', { ids: ['np-1'] });
  assert.equal(missing.error.message, 'claude not installed');
  assert.equal(loadRaw('np-1').extracted.summary, null, 'nothing was attempted');

  const found = await call('autotag', { ids: ['np-1'], extraPath: [dir] });
  assert.deepEqual(found.result, { tagged: 1, failed: 0 });
  assert.equal(loadRaw('np-1').extracted.summary, 'from stub');
});
