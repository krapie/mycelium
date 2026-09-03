import { DatabaseSync } from 'node:sqlite';
import { ensureDirs, DB_PATH } from './paths.js';
import { allRaw } from './scanner.js';
import { firstUserText, searchableText } from './schema.js';
import { isArchive, isInSubtree } from './organize.js';

// The sqlite index is a DERIVED artifact — it can be dropped and rebuilt from
// raw/ at any time (files are the source of truth). ai-memory validated that
// FTS5 alone is enough at personal scale; no embeddings needed for the POC.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  source TEXT,
  folder TEXT,
  started_at TEXT,
  preview TEXT,
  title TEXT,
  summary TEXT,
  organized_by TEXT,
  kind TEXT,
  done_at TEXT,
  continuation_of TEXT,
  continued_to TEXT,
  tags TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS session_fts USING fts5(
  id UNINDEXED, body
);
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  parent_id INTEGER
);
CREATE TABLE IF NOT EXISTS session_tags (
  session_id TEXT,
  tag_id INTEGER,
  PRIMARY KEY (session_id, tag_id)
);
`;

let db = null;

export function openDb() {
  if (db) return db;
  ensureDirs();
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  // Migrate older index DBs that predate the title column (index is derived,
  // but we ALTER rather than drop to keep it simple).
  try {
    db.exec('ALTER TABLE sessions ADD COLUMN title TEXT');
  } catch (err) {
    if (!String(err.message).includes('duplicate column')) throw err;
  }
  for (const col of ['continuation_of TEXT', 'continued_to TEXT', 'tags TEXT', 'merged_from TEXT', 'split_from TEXT', 'superseded_by TEXT', 'split_into TEXT', 'ended_at TEXT', 'kind TEXT', 'done_at TEXT']) {
    try {
      db.exec(`ALTER TABLE sessions ADD COLUMN ${col}`);
    } catch (err) {
      if (!String(err.message).includes('duplicate column')) throw err;
    }
  }
  return db;
}

function prepareWriters(d) {
  return {
    insSession: d.prepare(
      'INSERT OR REPLACE INTO sessions (id, source, folder, started_at, ended_at, preview, title, summary, organized_by, kind, done_at, continuation_of, continued_to, tags, merged_from, split_from, superseded_by, split_into) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ),
    insFts: d.prepare('INSERT INTO session_fts (id, body) VALUES (?, ?)'),
    upsertTag: d.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)'),
    getTag: d.prepare('SELECT id FROM tags WHERE name = ?'),
    linkTag: d.prepare('INSERT OR IGNORE INTO session_tags (session_id, tag_id) VALUES (?, ?)'),
  };
}

function writeSessionRow(w, n) {
  w.insSession.run(
    n.id,
    n.source,
    n.folder,
    n.startedAt,
    n.endedAt,
    firstUserText(n),
    n.extracted.title ?? null,
    n.extracted.summary ?? null,
    n.organizedBy,
    n.kind ?? 'session',
    n.doneAt ?? null,
    n.continuationOf ?? null,
    JSON.stringify(n.continuedTo || []),
    JSON.stringify(n.extracted.tags || []),
    JSON.stringify(n.mergedFrom || []),
    n.splitFrom ?? null,
    JSON.stringify(n.supersededBy || []),
    JSON.stringify(n.splitInto || []),
  );
  w.insFts.run(n.id, searchableText(n));
  for (const tag of n.extracted.tags || []) {
    w.upsertTag.run(tag);
    const row = w.getTag.get(tag);
    if (row) w.linkTag.run(n.id, row.id);
  }
}

/** Rebuild the entire index from raw/. O(total sessions) — use for genuinely
 * store-wide changes (scan, bulk organize/tag). For a single/few-session
 * mutation (move, tag, resume, ...), use reindexOne/reindexMany instead —
 * this full rebuild pays for a full raw/ reparse + FTS rebuild every time,
 * which gets slow once the store has hundreds/thousands of sessions. */
export function reindex() {
  const d = openDb();
  d.exec('DELETE FROM sessions; DELETE FROM session_fts; DELETE FROM session_tags;');
  const w = prepareWriters(d);
  const raws = allRaw();
  for (const n of raws) writeSessionRow(w, n);
  return raws.length;
}

/** Incrementally update ONE session's row — O(1) instead of reindex()'s
 * O(total sessions), for the common case where exactly one session changed. */
export function reindexOne(n) {
  const d = openDb();
  d.prepare('DELETE FROM sessions WHERE id = ?').run(n.id);
  d.prepare('DELETE FROM session_fts WHERE id = ?').run(n.id);
  d.prepare('DELETE FROM session_tags WHERE session_id = ?').run(n.id);
  writeSessionRow(prepareWriters(d), n);
}

/** Same as reindexOne, batched over a handful of sessions (one still-cheap
 * statement round-trip per session, not a full-store rebuild). */
export function reindexMany(sessions) {
  for (const n of sessions) reindexOne(n);
}

/** Remove one session from the index (after a delete — there's no raw file
 * left to reindexOne() from). */
export function removeFromIndex(id) {
  const d = openDb();
  d.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  d.prepare('DELETE FROM session_fts WHERE id = ?').run(id);
  d.prepare('DELETE FROM session_tags WHERE session_id = ?').run(id);
}

/** Session counts grouped by folder — for the TUI folder tree, without reading raw/. */
export function folderCounts() {
  const d = openDb();
  // Sessions folded into a merge/split product don't count toward the
  // folder tree's numbers either — same rule listSessions()/search() apply,
  // otherwise a folder's badge count would disagree with what's actually in
  // its session list once something in it gets merged/split away.
  return d
    .prepare(
      "SELECT COALESCE(folder, '') AS folder, COUNT(*) AS n FROM sessions WHERE superseded_by IS NULL OR superseded_by = '[]' GROUP BY folder",
    )
    .all();
}

/** Session counts per day-of-month (also grouped by folder, so callers can
 * exclude _archive the same way folderCounts()'s callers do) — for one
 * calendar month's grid. Grouped by `ended_at` (falls back to `started_at`
 * for the rare row missing it) — a session's last activity, not when it was
 * first created, is what should decide which day it shows up on: a session
 * started on day 1 but actively worked on through day 5 belongs on day 5's
 * count, not buried back on day 1. */
export function sessionCountsByDay(yearMonth /* 'YYYY-MM' */) {
  const d = openDb();
  return d
    .prepare(
      "SELECT CAST(substr(COALESCE(ended_at, started_at), 9, 2) AS INTEGER) AS day, COALESCE(folder, '') AS folder, COUNT(*) AS n FROM sessions WHERE substr(COALESCE(ended_at, started_at), 1, 7) = ? AND (superseded_by IS NULL OR superseded_by = '[]') GROUP BY day, folder",
    )
    .all(yearMonth);
}

// A sqlite row's superseded_by is a JSON array string (mirrors continued_to's
// shape) — non-empty means this session was folded into a merge/split product.
function hasSupersededBy(row) {
  return jsonArrayLength(row.superseded_by) > 0;
}

function jsonArrayLength(s) {
  if (!s) return 0;
  try {
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}


/**
 * Non-search list feed: sessions ordered by started_at DESC.
 * folder === null → only unfiled (Root); folder string → that subtree; undefined → everything.
 * `date` ('YYYY-MM-DD'), if given, narrows to that single day (matches
 * folder's post-query filter style rather than a separate WHERE clause).
 */
export function listSessions({ folder, date, includeSuperseded = false } = {}) {
  const d = openDb();
  let rows = d.prepare('SELECT * FROM sessions ORDER BY started_at DESC').all();
  // Matches sessionCountsByDay()'s grouping — a day's session list should be
  // "sessions active that day", same basis as what the calendar grid counted.
  if (date) rows = rows.filter((r) => (r.ended_at || r.started_at || '').slice(0, 10) === date);
  // _archive is hidden by default everywhere (same rule folderCounts()'s
  // callers apply) unless the caller is explicitly browsing into it.
  if (!isArchive(folder)) rows = rows.filter((r) => !isArchive(r.folder));
  // Sessions folded into a merge/split product are hidden by default too —
  // their content now lives in that product, so they'd otherwise duplicate
  // rows in every list/search. loadRaw()/data.detail() (direct-by-id lookups,
  // not a list scan) are unaffected — this only guards list-shaped queries.
  if (!includeSuperseded) rows = rows.filter((r) => !hasSupersededBy(r));
  if (folder === undefined) return rows;
  if (folder === null) return rows.filter((r) => !r.folder);
  return rows.filter((r) => isInSubtree(r.folder, folder));
}

/**
 * Search sessions. `query` runs against FTS5 (optional); `tags` filters to
 * sessions carrying ALL of the given tags; `folder` restricts the same way
 * listSessions() does (undefined = everything, null = only unfiled, a path =
 * that subtree). Combined tag + text filtering is the pi-session-manager
 * pattern.
 */
export function search({ query, tags = [], folder, date, includeSuperseded = false } = {}) {
  const d = openDb();
  let ids = null;
  let rankOrder = null;
  const snippets = new Map();

  if (query && query.trim()) {
    // snippet() column index 1 = FTS's `body` (id is column 0 and UNINDEXED).
    // bm25 via `ORDER BY rank` puts relevance-scored hits first — otherwise
    // the outer started_at DESC sort would drown out topically-strong matches
    // with anything more recent.
    const rows = d
      .prepare(
        "SELECT id, snippet(session_fts, 1, '', '', '…', 10) AS snip FROM session_fts WHERE session_fts MATCH ? ORDER BY rank",
      )
      .all(ftsQuery(query));
    ids = new Set(rows.map((r) => r.id));
    rankOrder = new Map();
    rows.forEach((r, i) => {
      rankOrder.set(r.id, i);
      if (r.snip) snippets.set(r.id, r.snip.replace(/\s+/g, ' ').trim());
    });
  }

  for (const tag of tags) {
    const rows = d
      .prepare(
        'SELECT st.session_id AS id FROM session_tags st JOIN tags t ON t.id = st.tag_id WHERE t.name = ?',
      )
      .all(tag);
    const tagIds = new Set(rows.map((r) => r.id));
    ids = ids === null ? tagIds : new Set([...ids].filter((x) => tagIds.has(x)));
  }

  let sessions = d.prepare('SELECT * FROM sessions ORDER BY started_at DESC').all();
  if (ids !== null) sessions = sessions.filter((s) => ids.has(s.id));
  // Same ended_at-first basis as listSessions()/sessionCountsByDay() — the
  // calendar's date filter goes through here too when combined with a search.
  if (date) sessions = sessions.filter((s) => (s.ended_at || s.started_at || '').slice(0, 10) === date);
  // _archive is hidden by default from search too (see listSessions()) unless
  // explicitly browsed into via folder.
  if (!isArchive(folder)) sessions = sessions.filter((s) => !isArchive(s.folder));
  // Same rule as listSessions() — merged/split-away originals stay out of
  // search results by default.
  if (!includeSuperseded) sessions = sessions.filter((s) => !hasSupersededBy(s));
  // Same three-way folder meaning as listSessions(): undefined = no
  // restriction, null = only genuinely unfiled (searching from the New
  // pseudo-folder), a path = that subtree.
  if (folder === null) sessions = sessions.filter((s) => !s.folder);
  else if (folder) sessions = sessions.filter((s) => isInSubtree(s.folder, folder));
  if (rankOrder) {
    for (const s of sessions) s.snippet = snippets.get(s.id) || null;
    sessions.sort((a, b) => (rankOrder.get(a.id) ?? 1e9) - (rankOrder.get(b.id) ?? 1e9));
  }
  return sessions;
}

// Turn a free-text query into a safe FTS5 MATCH expression: quote each token so
// punctuation / Korean text can't break the FTS grammar, OR them together.
function ftsQuery(q) {
  const tokens = q.split(/\s+/).filter(Boolean).map((t) => `"${t.replace(/"/g, '')}"`);
  return tokens.join(' OR ');
}

export function listTags() {
  const d = openDb();
  return d
    .prepare(
      'SELECT t.name, COUNT(st.session_id) AS n FROM tags t LEFT JOIN session_tags st ON st.tag_id = t.id GROUP BY t.id ORDER BY n DESC',
    )
    .all();
}
