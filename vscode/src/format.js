/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

'use strict';
const { strings } = require('./i18n.js');

const DAY = 86400000;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "5m ago" / "3d ago" … from an ISO timestamp; '' when there isn't one. */
function relativeTime(iso, now = Date.now(), language = 'en') {
  const t = Date.parse(iso || '');
  if (Number.isNaN(t)) return '';
  const ago = strings(language).ago;
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return ago.now;
  if (s < 3600) return ago.m(Math.floor(s / 60));
  if (s < DAY / 1000) return ago.h(Math.floor(s / 3600));
  const days = Math.floor(s / (DAY / 1000));
  if (days < 7) return ago.d(days);
  if (days < 30) return ago.w(Math.floor(days / 7));
  return ago.mo(Math.max(1, Math.floor(days / 30)));
}

/**
 * Calendar-day buckets for the Recent view: today, yesterday, the rest of the
 * last week, then up to `maxDays` back. Counted in local calendar days (not
 * 24h windows), so something from 23:50 last night is "yesterday" at 00:10.
 * Rows older than `maxDays` are dropped; empty buckets are omitted.
 */
function groupByRecency(rows, now = Date.now(), maxDays = 14) {
  const today = startOfDay(new Date(now));
  const buckets = { today: [], yesterday: [], thisWeek: [], earlier: [] };
  for (const r of rows) {
    const t = Date.parse(r.startedAt || '');
    if (Number.isNaN(t)) continue;
    const diff = Math.round((today - startOfDay(new Date(t))) / DAY);
    if (diff < 0 || diff === 0) buckets.today.push(r);
    else if (diff === 1) buckets.yesterday.push(r);
    else if (diff < 7) buckets.thisWeek.push(r);
    else if (diff < maxDays) buckets.earlier.push(r);
  }
  return Object.entries(buckets).filter(([, v]) => v.length).map(([key, v]) => ({ key, rows: v }));
}

/** Key into the agent color/icon tables: claude | codex | kiro | opencode | merged | backlog. */
function agentKey(row) {
  if (row.kind === 'backlog') return 'backlog';
  if ((row.mergedFrom && row.mergedFrom.length) || row.splitFrom || row.source === 'merged') return 'merged';
  const s = String(row.source || '');
  if (s.startsWith('claude')) return 'claude';
  return ['codex', 'kiro', 'opencode'].includes(s) ? s : 'claude';
}

const LABELS = { claude: 'Claude', codex: 'Codex', kiro: 'Kiro', opencode: 'OpenCode', merged: 'merged', backlog: 'backlog' };
const agentLabel = (row) => LABELS[agentKey(row)];

module.exports = { relativeTime, groupByRecency, agentKey, agentLabel };
