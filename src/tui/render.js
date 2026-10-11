/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

import pkg from 'neo-blessed';
import { C, sourceColor, sourceLabel } from './theme.js';
import * as data from './data.js';
import { t } from './i18n.js';
import { listClips } from '../clip.js';

// Break a summary paragraph into sentence-sized bullet points for the detail
// pane. summary is stored as prose (learn.js asks the LLM for 2-3 sentences),
// but a dense paragraph is harder to scan than the bullet list decisions/todos
// already use — this is a display-only split, the stored string is untouched.
/**
 * Cut `text` to at most `maxCells` terminal cells. Hangul and other wide
 * characters take two cells each, so a `.slice()` by characters let a Korean
 * title run twice as wide as an English one, past the row and over its
 * badges (#137).
 */
export function truncateCells(text, maxCells) {
  let out = '';
  let used = 0;
  for (const ch of text) {
    const w = pkg.unicode.strWidth(ch);
    if (used + w > maxCells) break;
    out += ch;
    used += w;
  }
  return out;
}

export function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The rich session detail body (title, source/date/folder, tags, summary
 * bullets, decisions, todos, continuation links) — shared between the main
 * Sessions detail panel and the Calendar tab's detail panel so both show the
 * exact same view instead of the calendar keeping a stripped-down copy.
 */
export function formatSessionDetail(n) {
  if (!n) return [];
  const lines = [];
  // Title as the headline, then metadata, then the description (summary).
  if (n.extracted.title) lines.push(`{${C.fox}-fg}{bold}${n.extracted.title}{/}`, '');
  // The calendar groups a session by its LAST activity, not when it started
  // (see index-db.js's sessionCountsByDay) — a session begun days ago but
  // still active today shows up on today's date there. Surface that same
  // span here so "why does this show up on that calendar day" is never a
  // mystery: only bother with the extra date when it actually differs from
  // the start day (the common case — start and end the same session, minutes
  // apart — stays exactly as compact as before).
  const started = (n.startedAt || '').slice(0, 16).replace('T', ' ');
  const ended = (n.endedAt || '').slice(0, 16).replace('T', ' ');
  const spansDays = n.startedAt && n.endedAt && n.startedAt.slice(0, 10) !== n.endedAt.slice(0, 10);
  const when = spansDays ? `${started} → ${t('detail.lastActive')} ${ended}` : started;
  lines.push(
    `{${sourceColor(n.source)}-fg}${sourceLabel(n.source)}{/}  {${C.dim}-fg}${when} · ${n.folder || t('sessions.newBadge')}{/}`,
  );
  // Full, untruncated id — the Sessions list row used to show a truncated
  // #<8-char> badge instead (removed — rarely what you're scanning a list
  // for, and crowded the row's metadata cluster); this is the one place the
  // real id is shown at all now, needed for things like `mycelium resume
  // <id>`/`mycelium context <id>` or filing a bug report.
  lines.push(`{${C.faint}-fg}${t('detail.id')} #${n.id}{/}`);
  if (n.extracted.tags?.length) {
    lines.push(n.extracted.tags.map((tg) => `{${C.tag}-fg}#${tg}{/}`).join(' '));
  }
  lines.push('');
  if (n.extracted.summary) {
    // Bullet points, not one prose paragraph — matches decisions/todos
    // below and is much easier to scan than a dense block of sentences.
    lines.push(`{${C.faint}-fg}${t('detail.summary')}{/}`, ...splitSentences(n.extracted.summary).map((s) => `- ${s}`), '');
  } else {
    lines.push(`{${C.faint}-fg}${t('detail.noSummary')}{/}`, '');
    const firstUser = n.turns.find((turn) => turn.role === 'user')?.text;
    if (firstUser) lines.push(`{${C.faint}-fg}${t('detail.firstRequest')}{/} ${firstUser.replace(/\s+/g, ' ').slice(0, 300)}`, '');
  }
  if (n.extracted.decisions?.length) lines.push(`{${C.faint}-fg}${t('detail.decisions')}{/}`, ...n.extracted.decisions.map((d) => `- ${d}`), '');
  if (n.extracted.todos?.length) lines.push(`{${C.faint}-fg}${t('detail.todos')}{/}`, ...n.extracted.todos.map((td) => `- ${td}`), '');
  // Handoff continuation links (this is one flow across a model switch).
  if (n.continuationOf) {
    lines.push('', `{${C.spore}-fg}${t('detail.continuationOf', refLabel(n.continuationOf))}{/}`);
  }
  for (const cid of n.continuedTo || []) {
    lines.push(`{${C.spore}-fg}${t('detail.continuedTo', refLabel(cid))}{/}`);
  }
  // Split/merge lineage — same text-link style as the continuation links
  // above, no new interactive-jump precedent needed.
  if (n.mergedFrom?.length) {
    const labels = n.mergedFrom.map((id) => refLabel(id)).join(', ');
    lines.push('', `{${C.merged}-fg}${t('detail.mergedFrom', n.mergedFrom.length, labels)}{/}`);
  }
  if (n.splitFrom) {
    lines.push('', `{${C.merged}-fg}${t('detail.splitFrom', refLabel(n.splitFrom))}{/}`);
  }
  if (n.supersededBy?.length) {
    const labels = n.supersededBy.map((id) => refLabel(id)).join(', ');
    lines.push('', `{${C.faint}-fg}${t('detail.superseded', labels)}{/}`);
  }
  if (n.splitInto?.length) {
    const labels = n.splitInto.map((id) => refLabel(id)).join(', ');
    lines.push('', `{${C.merged}-fg}${t('detail.splitInto', n.splitInto.length, labels)}{/}`);
  }
  const clips = listClips({ sessionId: n.id });
  if (clips.length) {
    lines.push('', `{${C.fox}-fg}${t('detail.clips', clips.length)}{/}`);
    for (const c of clips) {
      const range = c.from === c.to ? `#${c.from}` : `#${c.from}-${c.to}`;
      const preview = c.turns.map((tn) => tn.text).join(' ').replace(/\s+/g, ' ');
      // Clips are mostly code/logs — escape so a literal `{...}` isn't parsed as a blessed tag.
      const body = pkg.escape(`${c.note ? `${c.note} — ` : ''}${preview.slice(0, 120)}`);
      lines.push(`- {${C.faint}-fg}${range}{/} ${body}`);
    }
  }
  return lines;
}

/**
 * A clip's detail body (the Clips entry under New): its note as the
 * headline, where it came from, then the pinned turns in full — the
 * session detail's own preview stops at 120 chars, this is where the whole
 * text is read. Escaped: clips are mostly code/logs.
 */
export function formatClipDetail(c) {
  if (!c) return [];
  const lines = [];
  if (c.note) lines.push(`{${C.fox}-fg}{bold}${pkg.escape(c.note)}{/}`, '');
  const range = c.from === c.to ? `#${c.from}` : `#${c.from}-${c.to}`;
  const from = pkg.escape(c.sessionTitle || c.sessionId.slice(0, 8));
  lines.push(`{${sourceColor(c.source)}-fg}${sourceLabel(c.source)}{/}  {${C.dim}-fg}${from} ${range} · ${(c.createdAt || '').slice(0, 16).replace('T', ' ')}{/}`);
  lines.push(`{${C.faint}-fg}${data.detail(c.sessionId) ? t('clip.jumpHint') : t('clip.sourceGone')}{/}`, '');
  for (const turn of c.turns) {
    lines.push(`{${C.faint}-fg}[${turn.role}]{/}`, pkg.escape(turn.text), '');
  }
  return lines;
}

function refLabel(id) {
  const n = data.detail(id);
  return (n ? sourceLabel(n.source) : '?') + ' #' + id.slice(0, 8);
}
