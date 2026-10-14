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
const { renderPanel, esc } = require('../src/panel-html.js');
const { relativeTime, groupByRecency, agentKey } = require('../src/format.js');

const base = {
  id: 'abc12345-aaaa', source: 'claude', startedAt: '2026-01-02T03:04:05Z', folder: 'Work/api', host: 'mac', turnCount: 4,
  extracted: { title: 'Fix login', tags: ['bug'], summary: 'Found it. Fixed it.', decisions: ['use cookies'], todos: ['add test'] },
  artifacts: { filesChanged: ['src/auth.js'] },
  lineage: { continuationOf: [{ id: 'prev-1', title: 'Earlier', source: 'codex' }], continuedTo: [], mergedFrom: [], splitFrom: [], splitInto: [] },
};
const render = (d, o = {}) => renderPanel(d, { nonce: 'N0NCE', now: Date.parse('2026-01-04T03:04:05Z'), ...o });

test('renders the session: title, crumbs, summary bullets, decisions, todos, files, lineage', () => {
  const h = render(base);
  assert.match(h, /<h1>Fix login<\/h1>/);
  assert.match(h, /data-folder="Work"[^>]*>Work<\/button>.*data-folder="Work\/api"/s);
  assert.match(h, /2d ago/);
  assert.match(h, /<li>Found it\.<\/li><li>Fixed it\.<\/li>/);
  assert.match(h, /<h2>Decisions<\/h2>/);
  assert.match(h, /class="box"/);
  assert.match(h, /data-action="file" data-path="src\/auth.js"/);
  assert.match(h, /data-action="open" data-id="prev-1"/);
  assert.match(h, /agent-codex/); // the lineage chip takes its own agent's color
});

test('locks scripts to the nonce and denies everything else', () => {
  const h = render(base);
  assert.match(h, /default-src 'none'; style-src 'nonce-N0NCE'; script-src 'nonce-N0NCE'/);
  assert.equal((h.match(/<script/g) || []).length, 1);
  assert.match(h, /<script nonce="N0NCE">/);
  assert.doesNotMatch(h, /onclick=|javascript:/i);
});

test('session text can not inject markup', () => {
  const evil = '<img src=x onerror=alert(1)>"\'</script><script>alert(2)</script>';
  const h = render({
    ...base, id: 'id"><b>', host: evil, folder: evil, projectDir: evil,
    extracted: { title: evil, tags: [evil], summary: evil, decisions: [evil], todos: [evil] },
    artifacts: { filesChanged: [evil] },
    lineage: { ...base.lineage, continuedTo: [{ id: evil, title: evil, source: 'claude' }] },
  });
  assert.doesNotMatch(h, /<img/);
  assert.equal((h.match(/<script/g) || []).length, 1, 'only the panel\'s own script');
  assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/, 'shown as text, never as a tag');
  // with quoted attribute values blanked, no element may carry an event-handler attribute
  assert.doesNotMatch(h.replace(/="[^"]*"/g, '=""'), /<[a-z][^>]*\son[a-z]+=/i);
  assert.ok(h.includes(esc(evil)));
});

test('merged/split sessions and backlog items can not be resumed, with the reason shown', () => {
  const merged = render({ ...base, mergedFrom: ['a', 'b'] });
  assert.match(merged, /data-action="resume" disabled/);
  assert.match(merged, /class="hint">Merged or split/);
  const backlog = render({ ...base, kind: 'backlog' });
  assert.match(backlog, /data-action="resume" disabled/);
  assert.match(backlog, /data-action="handoff" disabled/);
  assert.doesNotMatch(backlog, /data-action="transcript"/);
  assert.doesNotMatch(render(base), /data-action="resume" disabled/);
});

test('an unsummarized session says how to get a summary; Korean follows the language', () => {
  const h = render({ ...base, extracted: { ...base.extracted, summary: null } }, { language: 'ko-KR' });
  assert.match(h, /아직 요약이 없습니다/);
  assert.match(h, /이어하기/);
  assert.match(h, /lang="ko-KR"/);
});

test('relativeTime picks the right unit, in both languages', () => {
  const now = Date.parse('2026-03-01T12:00:00Z');
  const ago = (ms, lang) => relativeTime(new Date(now - ms).toISOString(), now, lang);
  assert.equal(ago(10e3), 'just now');
  assert.equal(ago(5 * 60e3), '5m ago');
  assert.equal(ago(3 * 3600e3), '3h ago');
  assert.equal(ago(2 * 86400e3), '2d ago');
  assert.equal(ago(15 * 86400e3), '2w ago');
  assert.equal(ago(70 * 86400e3), '2mo ago');
  assert.equal(ago(2 * 86400e3, 'ko'), '2일 전');
  assert.equal(relativeTime(null, now), '');
});

test('groupByRecency buckets by calendar day, drops what is too old, omits empty buckets', () => {
  const now = new Date(2026, 2, 10, 0, 10).getTime(); // 00:10 local
  const at = (dayOffset, h = 12) => ({ startedAt: new Date(2026, 2, 10 + dayOffset, h).toISOString() });
  const rows = [at(0, 0), at(-1, 23), at(-3), at(-9), at(-30)];
  const g = Object.fromEntries(groupByRecency(rows, now).map((b) => [b.key, b.rows.length]));
  assert.deepEqual(g, { today: 1, yesterday: 1, thisWeek: 1, earlier: 1 });
  assert.deepEqual(groupByRecency([at(-30)], now), []);
});

test('agentKey maps sources, merge products and backlog items', () => {
  assert.equal(agentKey({ source: 'claude-code' }), 'claude');
  assert.equal(agentKey({ source: 'codex' }), 'codex');
  assert.equal(agentKey({ source: 'claude', mergedFrom: ['x'] }), 'merged');
  assert.equal(agentKey({ kind: 'backlog' }), 'backlog');
  assert.equal(agentKey({ source: 'who-knows' }), 'claude');
});

test('a Claude session offers "In terminal" next to Resume; other agents, merge products and backlog items do not', () => {
  const uuid = '3f2a9c1e-5b7d-4e8a-9c3b-1a2b3c4d5e6f';
  assert.match(render({ ...base, id: uuid }), /data-action="resumeInTerminal"/);
  assert.doesNotMatch(render({ ...base, id: uuid, source: 'codex' }), /resumeInTerminal/);
  assert.doesNotMatch(render({ ...base, id: uuid, mergedFrom: ['a', 'b'] }), /resumeInTerminal/);
  assert.doesNotMatch(render({ ...base, id: uuid, kind: 'backlog' }), /resumeInTerminal/);
  assert.doesNotMatch(render(base), /resumeInTerminal/, 'an id Claude Code could not resume');
});
