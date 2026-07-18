import { DatabaseSync } from 'node:sqlite';
import { ensureDirs, DB_PATH } from './paths.js';
import { allRaw } from './scanner.js';
import { firstUserText, searchableText } from './schema.js';

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
  organized_by TEXT
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
  return db;
}

/** Rebuild the entire index from raw/. Cheap at personal scale; always correct. */
export function reindex() {
  const d = openDb();
  d.exec('DELETE FROM sessions; DELETE FROM session_fts; DELETE FROM session_tags;');
  const insSession = d.prepare(
    'INSERT OR REPLACE INTO sessions (id, source, folder, started_at, preview, title, summary, organized_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insFts = d.prepare('INSERT INTO session_fts (id, body) VALUES (?, ?)');
  const upsertTag = d.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
  const getTag = d.prepare('SELECT id FROM tags WHERE name = ?');
  const linkTag = d.prepare('INSERT OR IGNORE INTO session_tags (session_id, tag_id) VALUES (?, ?)');

  const raws = allRaw();
  for (const n of raws) {
    insSession.run(n.id, n.source, n.folder, n.startedAt, firstUserText(n), n.extracted.title ?? null, n.extracted.summary ?? null, n.organizedBy);
    insFts.run(n.id, searchableText(n));
    for (const tag of n.extracted.tags || []) {
      upsertTag.run(tag);
      const row = getTag.get(tag);
      if (row) linkTag.run(n.id, row.id);
    }
  }
  return raws.length;
}

/**
 * Search sessions. `query` runs against FTS5 (optional); `tags` filters to
 * sessions carrying ALL of the given tags; `folder` restricts to a subtree.
 * Combined tag + text filtering is the pi-session-manager pattern.
 */
export function search({ query, tags = [], folder } = {}) {
  const d = openDb();
  let ids = null;

  if (query && query.trim()) {
    const rows = d.prepare('SELECT id FROM session_fts WHERE session_fts MATCH ?').all(ftsQuery(query));
    ids = new Set(rows.map((r) => r.id));
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
  if (folder) sessions = sessions.filter((s) => s.folder && (s.folder === folder || s.folder.startsWith(folder + '/')));
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
