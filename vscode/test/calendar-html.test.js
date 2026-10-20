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
const { renderCalendar, level } = require('../src/calendar-html.js');

const NOW = Date.parse('2026-10-20T12:00:00Z');
const render = (o = {}) => renderCalendar({ year: 2026, month: 10, counts: {}, nonce: 'N0NCE', now: NOW, ...o });
const row = (o = {}) => ({ id: 'abc12345-1', title: 'Fix login', source: 'claude', startedAt: '2026-10-20T01:00:00Z', folder: 'Work/api', ...o });

test('draws every day of the month, offset to its weekday (Sunday first)', () => {
  const h = render();
  assert.equal((h.match(/data-action="day"/g) || []).length, 31);
  assert.equal((h.match(/class="day-pad"/g) || []).length, 4); // 2026-10-01 is a Thursday
  assert.match(h, /<span class="wd">Su<\/span>.*<span class="wd">Sa<\/span>/s);
  assert.match(h, /<h1>October 2026<\/h1>/);
  assert.equal((render({ year: 2028, month: 2 }).match(/data-action="day"/g) || []).length, 29, 'leap February');
});

test('a day shows its count and shade; empty days show neither', () => {
  assert.deepEqual([0, 1, 2, 3, 5, 6, 40].map(level), [0, 1, 1, 2, 2, 3, 3]);
  const h = render({ counts: { 5: 1, 20: 7 } });
  assert.match(h, /class="day lv1" data-action="day" data-date="2026-10-05"[^>]*><span class="d">5<\/span><span class="n">1<\/span>/);
  assert.match(h, /class="day lv3"[^>]*data-date="2026-10-20"[^>]*aria-label="October 20, 7 sessions"/);
  assert.match(h, /data-date="2026-10-06"[^>]*><span class="d">6<\/span><\/button>/);
});

test('marks today and the selected day; only the selected day is a tab stop', () => {
  const h = render({ today: '2026-10-19', selected: '2026-10-20' });
  assert.match(h, /class="day lv0 today"[^>]*data-date="2026-10-19"/);
  assert.match(h, /class="day lv0 selected"[^>]*data-date="2026-10-20"[^>]*tabindex="0"[^>]*aria-pressed="true"/);
  assert.equal((h.match(/tabindex="0"/g) || []).length, 1);
  assert.equal((render().match(/tabindex="0"/g) || []).length, 1, 'with nothing selected, the 1st is the stop');
});

test('the selected day lists its sessions with Resume and Hand off; merged ones can only be handed off', () => {
  const h = render({ selected: '2026-10-20', rows: [row(), row({ id: 'm-1', title: 'Merged', mergedFrom: ['a', 'b'] })] });
  assert.match(h, /<h2>October 20 · 2 sessions<\/h2>/);
  assert.match(h, /data-action="open" data-id="abc12345-1"[^>]*>.*Fix login/s);
  assert.match(h, /data-action="resume" data-id="abc12345-1">Resume/);
  assert.match(h, /data-action="resume" data-id="m-1" disabled/);
  assert.match(h, /data-action="handoff" data-id="m-1">/);
});

test('backlog rows can be opened but not resumed; empty and unselected days say so', () => {
  const h = render({ selected: '2026-10-20', rows: [row({ id: 'b-1', kind: 'backlog', source: null })] });
  assert.match(h, /data-action="open" data-id="b-1"/);
  assert.doesNotMatch(h, /data-action="resume"/);
  assert.match(render({ selected: '2026-10-20' }), /Nothing captured on this day\./);
  assert.match(render(), /Pick a day/);
});

test('has previous/next/today controls; Korean follows the language', () => {
  const h = render();
  assert.match(h, /data-action="month" data-delta="-1"/);
  assert.match(h, /data-action="month" data-delta="1"/);
  assert.match(h, /data-action="today">Today/);
  const ko = render({ language: 'ko', counts: { 3: 2 }, selected: '2026-10-03', rows: [row()] });
  assert.match(ko, /<h1>10월 2026<\/h1>/);
  assert.match(ko, /<span class="wd">일<\/span>/);
  assert.match(ko, /<h2>10월 3일 · 세션 1개<\/h2>/);
  assert.match(ko, /data-action="today">오늘/);
});

test('keyboard navigation is flagged only when asked for', () => {
  assert.match(render({ kbd: true }), /<body data-kbd="1">/);
  assert.doesNotMatch(render(), /data-kbd/);
});

test('locks scripts to the nonce, and session text can not inject markup', () => {
  const evil = '<img src=x onerror=alert(1)>"\'</script><script>alert(2)</script>';
  const h = render({ selected: '2026-10-20', rows: [row({ id: 'id"><b>', title: evil, folder: evil, summary: evil })] });
  assert.match(h, /default-src 'none'; style-src 'nonce-N0NCE'; script-src 'nonce-N0NCE'/);
  assert.equal((h.match(/<script/g) || []).length, 1, 'only the page\'s own script');
  assert.doesNotMatch(h, /<img/);
  assert.doesNotMatch(h, /onclick=|javascript:/i);
  assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/);
});
