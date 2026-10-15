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
const { isClaudeSession } = require('./claude-code.js');

// Everything below that came from a session (title, summary, paths, ids…)
// originates in an agent transcript, i.e. it is untrusted: it only ever
// reaches the page through esc().
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const svg = (d) => `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${d}"/></svg>`;
const ICON = {
  play: svg('M5 3.5v9l7.5-4.5z'),
  swap: svg('M3 5h9.5M10 2.5L12.5 5 10 7.5M13 11H3.5M6 8.5L3.5 11 6 13.5'),
  copy: svg('M5.5 5.5h8v8h-8zM3 10.5V2.5h8'),
  folder: svg('M2 4h4l1.5 1.5H14V13H2z'),
  tag: svg('M2.5 2.5h5.5l5.5 5.5-5 5-6-5.5z'),
  spark: svg('M8 2l1.4 4L13.5 7.5 9.4 9 8 13 6.6 9 2.5 7.5 6.6 6z'),
};

const SCRIPT = `const vscode = acquireVsCodeApi();
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  vscode.postMessage({ action: el.dataset.action, id: el.dataset.id, folder: el.dataset.folder, path: el.dataset.path });
});`;

const sentences = (text) => String(text).split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

function crumbs(folder, t) {
  if (!folder) return `<span>${esc(t.unfiled)}</span>`;
  const parts = folder.split('/');
  return parts
    .map((p, i) => `<button class="crumb" data-action="folder" data-folder="${esc(parts.slice(0, i + 1).join('/'))}">${esc(p)}</button>`)
    .join('<span class="sep">›</span>');
}

function button({ action, label, icon, primary, disabled, title }) {
  return `<button class="btn${primary ? ' primary' : ''}" data-action="${action}"${disabled ? ' disabled' : ''}${title ? ` title="${esc(title)}"` : ''}>${icon || ''}${esc(label)}</button>`;
}

function refChip(r) {
  const label = r.title || r.id.slice(0, 8);
  return `<button class="ref agent-${agentKey(r)}" data-action="open" data-id="${esc(r.id)}" title="${esc(r.id)}"><span class="dot"></span><span class="t">${esc(label)}</span></button>`;
}

/**
 * The session detail page. `d` is the bridge's `detail` result (no turns,
 * plus `lineage`). Pure: no `vscode`, so it can be tested as a string.
 */
function renderPanel(d, { nonce, language = 'en', now = Date.now() } = {}) {
  const t = strings(language);
  const x = d.extracted || {};
  const key = agentKey(d);
  const backlog = d.kind === 'backlog';
  const product = !!((d.mergedFrom && d.mergedFrom.length) || d.splitFrom);
  const hint = backlog ? t.backlogNotResumable : product ? t.notResumable : '';
  const started = (d.startedAt || '').slice(0, 16).replace('T', ' ');

  const meta = [
    `<span class="agent"><span class="dot"></span>${esc(agentLabel(d))}</span>`,
    d.startedAt ? `<span title="${esc(started)}">${esc(relativeTime(d.startedAt, now, language))}</span>` : '',
    `<span>${crumbs(d.folder, t)}</span>`,
    d.host ? `<span>@${esc(d.host)}</span>` : '',
  ].filter(Boolean);

  const list = (heading, items, cls = 'bullets') =>
    items && items.length ? `<section><h2>${esc(heading)}</h2><ul class="${cls}">${items.map((i) => `<li>${cls === 'todos' ? '<span class="box"></span><span>' : ''}${esc(i)}${cls === 'todos' ? '</span>' : ''}</li>`).join('')}</ul></section>` : '';

  const summary = x.summary
    ? list(t.summary, sentences(x.summary))
    : `<section><h2>${esc(t.summary)}</h2><p class="empty">${esc(t.noSummary)}</p></section>`;

  const files = (d.artifacts && d.artifacts.filesChanged) || [];
  const filesHtml = files.length
    ? `<section><h2>${esc(t.files)}</h2><div class="files">${files.slice(0, 30).map((f) => `<button class="file" data-action="file" data-path="${esc(f)}">${esc(f)}</button>`).join('')}</div></section>`
    : '';

  const lin = d.lineage || {};
  const rows = [
    [t.continuationOf, lin.continuationOf],
    [t.continuedTo, lin.continuedTo],
    [t.mergedFrom, lin.mergedFrom],
    [t.splitFrom, lin.splitFrom],
    [t.splitInto, lin.splitInto],
  ].filter(([, v]) => v && v.length);
  const lineage = rows.length
    ? `<section><h2>${esc(t.lineage)}</h2>${rows.map(([label, v]) => `<div class="lineage-row"><span class="label">${esc(label)}</span>${v.map(refChip).join('')}</div>`).join('')}</section>`
    : '';

  const csp = `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'`;
  return `<!DOCTYPE html>
<html lang="${esc(language)}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">${css}</style></head>
<body class="agent-${key}"><main>
<div class="meta">${meta.join('<span class="sep">·</span>')}</div>
<h1>${esc(x.title || t.untitled)}</h1>
${x.tags && x.tags.length ? `<div class="tags">${x.tags.map((g) => `<span class="tag">#${esc(g)}</span>`).join('')}</div>` : ''}
<div class="actions">
${button({ action: 'resume', label: t.resume, icon: ICON.play, primary: true, disabled: !!hint, title: hint })}
${isClaudeSession(d) ? button({ action: 'resumeInTerminal', label: t.resumeTerminal, icon: ICON.play, title: t.resumeTerminalTip }) : ''}
${button({ action: 'handoff', label: t.handoff, icon: ICON.swap, disabled: backlog, title: backlog ? t.backlogNotResumable : '' })}
${button({ action: 'copyPrompt', label: t.copyPrompt, icon: ICON.copy, disabled: backlog })}
${button({ action: 'move', label: t.move, icon: ICON.folder })}
${button({ action: 'tag', label: t.tag, icon: ICON.tag })}
${button({ action: 'autotag', label: t.summarize, icon: ICON.spark, disabled: backlog })}
${button({ action: 'delete', label: t.delete })}
${hint ? `<p class="hint">${esc(hint)}</p>` : ''}
</div>
${summary}
${list(t.decisions, x.decisions)}
${list(t.todos, x.todos, 'todos')}
${filesHtml}
${lineage}
<footer>
<button class="link" data-action="copyId" title="${esc(t.copyId)}"><code>${esc(d.id)}</code></button>
<span>${esc(d.turnCount ?? 0)} ${esc(t.turns)}</span>
${d.projectDir || d.cwd ? `<code>${esc(d.projectDir || d.cwd)}</code>` : ''}
${backlog ? '' : `<button class="link" data-action="transcript">${esc(t.transcript)}</button>`}
</footer>
</main>
<script nonce="${nonce}">${SCRIPT}</script>
</body></html>`;
}

module.exports = { renderPanel, esc };
