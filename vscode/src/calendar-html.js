/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

'use strict';
const css = require('./panel-css.js');
const { strings } = require('./i18n.js');
const { relativeTime, agentKey, agentLabel } = require('./format.js');
const { esc } = require('./panel-html.js');

const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
const level = (n) => (n >= 6 ? 3 : n >= 3 ? 2 : n >= 1 ? 1 : 0);

const CAL_CSS = `
main.cal { max-width: 860px; }
.cal-head { display: flex; align-items: center; gap: 8px; margin: 0 0 14px; }
.cal-head h1 { margin: 0 auto 0 0; font-size: 1.5em; }
.cal-head .btn { padding: 4px 10px; }
.grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
.wd { text-align: center; font-size: 0.85em; color: var(--vscode-descriptionForeground); padding-bottom: 2px; }
.day { --lv: 0; position: relative; min-height: 52px; padding: 6px 8px; text-align: left; border-radius: 3px; color: var(--vscode-foreground);
  border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, transparent));
  background: color-mix(in srgb, var(--vscode-textLink-foreground) calc(var(--lv) * 17%), transparent); }
.day:hover { border-color: var(--vscode-focusBorder); }
.day.lv1 { --lv: 1; } .day.lv2 { --lv: 2; } .day.lv3 { --lv: 3; }
.day .n { position: absolute; right: 8px; bottom: 5px; font-size: 0.85em; font-weight: 600; }
.day.today .d { text-decoration: underline; text-underline-offset: 3px; font-weight: 700; }
.day.selected { outline: 2px solid var(--vscode-focusBorder); outline-offset: 0; }
.day-pad { min-height: 52px; }
.day-list { margin: 22px 0 0; padding: 0; list-style: none; }
.day-list h2 { margin: 0 0 8px; font-size: 1.1em; }
.srow { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-top: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, transparent)); }
.srow .open { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; text-align: left; background: none; border: 0; color: var(--vscode-foreground); padding: 2px 0; }
.srow .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.srow .sub { color: var(--vscode-descriptionForeground); font-size: 0.88em; white-space: nowrap; }
.srow .btn { padding: 2px 9px; font-size: 0.9em; }
@media (max-width: 520px) { .day { min-height: 40px; padding: 4px; } .srow .sub { display: none; } }
`;

const SCRIPT = `const vscode = acquireVsCodeApi();
const shift = (date, days) => { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  vscode.postMessage({ action: el.dataset.action, date: el.dataset.date, id: el.dataset.id, delta: el.dataset.delta });
});
document.addEventListener('keydown', (e) => {
  const el = e.target.closest('.day');
  if (!el) return;
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
  if (!step) return;
  e.preventDefault();
  vscode.postMessage({ action: 'day', date: shift(el.dataset.date, step), kbd: true });
});
if (document.body.dataset.kbd) { const s = document.querySelector('.day.selected'); if (s) s.focus(); }`;

function sessionRow(r, t, language, now) {
  const key = agentKey(r);
  const label = r.title || (r.preview || '').slice(0, 70) || r.id.slice(0, 8) || t.cal.untitled;
  const product = !!((r.mergedFrom && r.mergedFrom.length) || r.splitFrom);
  const backlog = r.kind === 'backlog';
  const sub = [agentLabel(r), r.folder || t.unfiled, relativeTime(r.startedAt, now, language)].filter(Boolean).join(' · ');
  const act = (action, label, disabled) => `<button class="btn" data-action="${action}" data-id="${esc(r.id)}"${disabled ? ' disabled' : ''}>${esc(label)}</button>`;
  return `<li class="srow agent-${key}"><button class="open" data-action="open" data-id="${esc(r.id)}" title="${esc(r.id)}"><span class="dot"></span><span class="t">${esc(label)}</span><span class="sub">${esc(sub)}</span></button>`
    + (backlog ? '' : `${act('resume', t.resume, product)}${act('handoff', t.handoff)}`) + '</li>';
}

/**
 * The calendar page: a month grid (a day's shade is how many sessions it
 * holds) and the selected day's sessions under it. `counts` is the bridge's
 * `calendar` result keyed by day of month; `rows` the `sessions({date})`
 * result for `selected` ('YYYY-MM-DD'). Pure: no `vscode`, testable as a string.
 */
function renderCalendar({ year, month, counts = {}, selected = null, rows = [], today = null, nonce, language = 'en', now = Date.now(), kbd = false }) {
  const t = strings(language);
  const c = t.cal;
  const firstDow = new Date(year, month - 1, 1).getDay();
  const dim = new Date(year, month, 0).getDate();

  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push('<span class="day-pad"></span>');
  for (let d = 1; d <= dim; d++) {
    const date = ymd(year, month, d);
    const n = Number(counts[d]) || 0;
    const cls = ['day', `lv${level(n)}`, date === today ? 'today' : '', date === selected ? 'selected' : ''].filter(Boolean).join(' ');
    // Roving tabindex: one stop in the grid, arrows move inside it.
    const stop = selected ? date === selected : d === 1;
    cells.push(`<button class="${cls}" data-action="day" data-date="${date}" tabindex="${stop ? 0 : -1}" aria-label="${esc(`${c.day(c.months[month - 1], d)}, ${c.sessionsN(n)}`)}" aria-pressed="${date === selected}"><span class="d">${d}</span>${n ? `<span class="n">${n}</span>` : ''}</button>`);
  }

  let list = `<p class="empty">${esc(c.pick)}</p>`;
  if (selected) {
    const [, sm, sd] = selected.split('-').map(Number);
    const heading = `${c.day(c.months[sm - 1], sd)} · ${c.sessionsN(rows.length)}`;
    list = `<h2>${esc(heading)}</h2>${rows.length ? `<ul class="day-list">${rows.map((r) => sessionRow(r, t, language, now)).join('')}</ul>` : `<p class="empty">${esc(c.none)}</p>`}`;
  }

  const csp = `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'`;
  return `<!DOCTYPE html>
<html lang="${esc(language)}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">${css}${CAL_CSS}</style></head>
<body${kbd ? ' data-kbd="1"' : ''}><main class="cal">
<div class="cal-head">
<h1>${esc(`${c.months[month - 1]} ${year}`)}</h1>
<button class="btn" data-action="month" data-delta="-1" aria-label="${esc(c.prev)}">‹</button>
<button class="btn" data-action="today">${esc(c.today)}</button>
<button class="btn" data-action="month" data-delta="1" aria-label="${esc(c.next)}">›</button>
</div>
<div class="grid" role="group" aria-label="${esc(`${c.months[month - 1]} ${year}`)}">
${c.weekdays.map((w) => `<span class="wd">${esc(w)}</span>`).join('')}
${cells.join('\n')}
</div>
<section>${list}</section>
</main>
<script nonce="${nonce}">${SCRIPT}</script>
</body></html>`;
}

module.exports = { renderCalendar, level };
