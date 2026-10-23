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

test('renders the session: title, crumbs, summary bullets, decisions, todos, lineage', () => {
  const h = render(base);
  assert.match(h, /<h1>Fix login<\/h1>/);
  assert.match(h, /data-folder="Work"[^>]*>Work<\/button>.*data-folder="Work\/api"/s);
  assert.match(h, /2d ago/);
  assert.match(h, /<li>Found it\.<\/li><li>Fixed it\.<\/li>/);
  assert.match(h, /<h2>Decisions<\/h2>/);
  assert.match(h, /class="box"/);
  assert.doesNotMatch(h, /data-action="file"/);
  assert.match(h, /data-action="open" data-id="prev-1"/);
  assert.match(h, /agent-codex/); // the lineage chip takes its own agent's color
});

test('the page has a Delete button, in the display language', () => {
  assert.match(render(base), /data-action="delete"[^>]*>Delete<\/button>/);
  assert.match(render(base, { language: 'ko' }), /data-action="delete"[^>]*>삭제<\/button>/);
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
    lineage: { ...base.lineage, continuedTo: [{ id: evil, title: evil, source: 'claude' }] },
  });
  assert.doesNotMatch(h, /<img/);
  assert.equal((h.match(/<script/g) || []).length, 1, 'only the panel\'s own script');
  assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/, 'shown as text, never as a tag');
  // with quoted attribute values blanked, no element may carry an event-handler attribute
  assert.doesNotMatch(h.replace(/="[^"]*"/g, '=""'), /<[a-z][^>]*\son[a-z]+=/i);
  assert.ok(h.includes(esc(evil)));
});

test('merged/split sessions can not be resumed, with the reason shown', () => {
  const merged = render({ ...base, mergedFrom: ['a', 'b'] });
  assert.match(merged, /data-action="resume" disabled/);
  assert.match(merged, /class="hint">Merged or split/);
  assert.doesNotMatch(render(base), /data-action="resume" disabled/);
});

test('a backlog item offers Start and Edit instead of Resume and Hand off, and shows its notes as written', () => {
  const item = { ...base, kind: 'backlog', source: null, extracted: { title: 'Add rate limiter', summary: 'per-IP.\nSecond line.' } };
  const h = render(item);
  assert.match(h, /data-action="backlogStart"[^>]*>.*Start<\/button>/s);
  assert.match(h, /data-action="backlogEdit"/);
  for (const gone of ['resume', 'handoff', 'copyPrompt', 'autotag', 'transcript']) assert.doesNotMatch(h, new RegExp(`data-action="${gone}"`));
  assert.match(h, /data-action="move"/);
  assert.match(h, /data-action="delete"/);
  assert.match(h, /<h2>Notes<\/h2><p class="notes">per-IP\.\nSecond line\.<\/p>/);
  assert.match(h, /class="hint">A note for later/);
  assert.match(render({ ...item, doneAt: '2026-01-03T00:00:00Z' }), /class="hint">Started\./);
  assert.match(render({ ...item, extracted: { title: 'x' } }), /No notes yet/);
  assert.match(render(item, { language: 'ko' }), /data-action="backlogStart"[^>]*>.*시작<\/button>/s);
});

test('backlog notes can not inject markup', () => {
  const h = render({ ...base, kind: 'backlog', extracted: { title: 'x', summary: '<img src=x onerror=alert(1)>' } });
  assert.doesNotMatch(h, /<img/);
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
