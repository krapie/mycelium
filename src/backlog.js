import { randomUUID } from 'node:crypto';
import { loadRaw, saveRaw, allRaw } from './scanner.js';
import { emptyNeutral, isBacklog, backlogSeedMarker } from './schema.js';
import { isInSubtree } from './organize.js';
import { contentLocale } from './config.js';

/**
 * Backlog items: a session you write yourself, before any agent has run.
 *
 * Stored as an ordinary session record with `kind: 'backlog'` and an empty
 * `turns` array — the title/description live in `extracted.title`/`.summary`,
 * the same two fields the list row and render.js's formatSessionDetail()
 * already display, so a backlog item shows up looking like every other
 * session with no rendering special-case. Empty `turns` is what it is
 * (nothing has been said yet) and conveniently makes the transcript-shaped
 * LLM paths (learn.js's autoTagSession, split.js) refuse it on their own;
 * the summary-shaped ones (insight/digest.js, insight/knowledge.js) still
 * need the explicit isBacklog() guard, since a note is intent, not knowledge.
 *
 * Opening one is the handoff flow with a note as the parent: launch.js's
 * launchAgent() takes buildBacklogSeed()'s prompt as its `seed` and the
 * backlog's id as its `parentId`, so whatever session the agent produces is
 * linkContinuation()'d back to the note it came from.
 */

export { isBacklog };

/**
 * Create a backlog item in `folder` (null = unfiled/New). `title` is required
 * — it's the row's whole identity in the list; `description` is optional.
 * organizedBy is 'human' because a person filed it deliberately, which also
 * keeps scanner.js's auto-archive sweep off it.
 */
export function createBacklog({ title, description = '', folder = null } = {}) {
  const t = (title || '').trim();
  if (!t) return { ok: false, error: 'backlog needs a title' };
  const now = new Date().toISOString();
  // Plain uuid, like merge products (organize/lineage.js) — `kind` is the
  // discriminator, and a 'backlog-' id prefix would eat the whole 8-char short
  // id every list/detail view shows.
  const n = emptyNeutral(randomUUID(), null);
  n.kind = 'backlog';
  n.startedAt = now;
  n.endedAt = now;
  n.folder = folder ?? null;
  n.organizedBy = 'human';
  n.extracted.title = t;
  n.titleLocked = true; // a human wrote it — same protection setContent() gives an edited title
  n.extracted.summary = (description || '').trim() || null;
  saveRaw(n);
  return { ok: true, session: n };
}

/** Stamp "you opened this" — set when the agent is actually launched (or its
 * command copied), not when the picker is merely opened and cancelled. */
export function markBacklogEntered(id) {
  const n = loadRaw(id);
  if (!isBacklog(n)) return { ok: false, error: `no backlog item ${id}` };
  n.doneAt = new Date().toISOString();
  saveRaw(n);
  return { ok: true, session: n };
}

/** Backlog items, newest first. `folder` scopes the same three ways
 * index-db.js's listSessions() does: undefined = everywhere, null = only
 * unfiled, a path = that subtree.
 *
 * Nothing is filtered out: an item stops existing the moment the session it
 * started is captured (scanner.js consumes it), so whatever is still here is
 * still waiting — including one whose command was handed out but never
 * actually run, which is exactly the thing a user needs to see again. */
export function listBacklog({ folder } = {}) {
  return allRaw()
    .filter((n) => isBacklog(n))
    .filter((n) => {
      if (folder === undefined) return true;
      if (folder === null) return !n.folder;
      return isInSubtree(n.folder, folder);
    })
    .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
}

/**
 * The prompt the agent starts with. Composed from the stored title/description
 * at open time (never stored alongside them), so editing either one via `e`/
 * setContent() can't leave a stale seed behind.
 *
 * Locale follows config.js's contentLocale(), same as handoff.js's
 * buildHandoff() and for the same reason (AGENTS.md's "Human-facing text"):
 * it's text a person reads and hands to another agent, not UI chrome. Two
 * maintained versions, not a translation layer.
 */
export function buildBacklogSeed(id, locale = contentLocale()) {
  const n = loadRaw(id);
  if (!isBacklog(n)) return { ok: false, error: `no backlog item ${id}` };
  const title = n.extracted.title || '';
  const desc = n.extracted.summary;
  const lines =
    locale === 'ko'
      ? [
          `# ${title}`,
          '',
          '이 작업은 Mycelium에 백로그로 적어둔 것이며, 지금 시작합니다. 아직 진행된 작업은 없습니다 — 아래 메모를 출발점으로 이 작업 디렉토리에서 시작하세요.',
        ]
      : [
          `# ${title}`,
          '',
          'This was queued as a backlog item in Mycelium and is starting now. No work has been done on it yet — start from the notes below, in this working directory.',
        ];
  if (desc) lines.push('', locale === 'ko' ? '**메모:**' : '**Notes:**', desc);
  // Trailing marker: this prompt is often COPIED into another terminal, where
  // the session it starts is out of reach of launchAgent()'s own
  // linkContinuation() — scanner.js redeems this on that session's first
  // import instead. See schema.js's backlogSeedMarker().
  lines.push('', backlogSeedMarker(n.id));
  return { ok: true, prompt: lines.join('\n'), session: n };
}
