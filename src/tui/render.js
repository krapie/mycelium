import { C, sourceColor } from './theme.js';
import * as data from './data.js';
import { t } from './i18n.js';

// Break a summary paragraph into sentence-sized bullet points for the detail
// pane. summary is stored as prose (learn.js asks the LLM for 2-3 sentences),
// but a dense paragraph is harder to scan than the bullet list decisions/todos
// already use — this is a display-only split, the stored string is untouched.
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
  const srcName = { codex: 'codex', kiro: 'kiro' }[n.source] ?? 'claude';
  // Title as the headline, then metadata, then the description (summary).
  if (n.extracted.title) lines.push(`{${C.fox}-fg}{bold}${n.extracted.title}{/}`, '');
  lines.push(
    `{${sourceColor(n.source)}-fg}${srcName}{/}  {${C.dim}-fg}${(n.startedAt || '').slice(0, 16).replace('T', ' ')} · ${n.folder || t('sessions.newBadge')}{/}`,
  );
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
    const p = data.detail(n.continuationOf);
    const label = p ? p.source + ' #' + n.continuationOf.slice(0, 8) : '#' + n.continuationOf.slice(0, 8);
    lines.push('', `{${C.spore}-fg}${t('detail.continuationOf', label)}{/}`);
  }
  for (const cid of n.continuedTo || []) {
    const c = data.detail(cid);
    const label = c ? c.source + ' #' + cid.slice(0, 8) : '#' + cid.slice(0, 8);
    lines.push(`{${C.spore}-fg}${t('detail.continuedTo', label)}{/}`);
  }
  return lines;
}
