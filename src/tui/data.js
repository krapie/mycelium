import { loadRaw } from '../scanner.js';
import {
  reindex,
  reindexOne,
  reindexMany,
  removeFromIndex,
  search,
  listTags,
  folderCounts,
  listSessions,
  sessionCountsByDay as dbSessionCountsByDay,
} from '../index-db.js';
import { listTreeDirs, isArchive } from '../organize.js';

// Thin data layer the TUI views read from. Folder tree and non-search session
// list are served from the sqlite index (5000+ raw files no longer re-read on
// every render); detail() still loads a single raw file, which is fine.

export function folders() {
  const direct = new Map(); // folder -> sessions filed directly in it (not descendants)
  let inbox = 0;
  let total = 0;
  for (const { folder, n } of folderCounts()) {
    if (isArchive(folder)) continue;
    total += n;
    if (!folder) inbox += n;
    else direct.set(folder, (direct.get(folder) || 0) + n);
  }
  // Every folder path that should appear in the tree: every folder with
  // direct sessions, every real (possibly empty) tree directory, plus every
  // ancestor path of either — so nested/empty folders always appear and are
  // selectable for folder operations.
  const paths = new Set(direct.keys());
  for (const dir of listTreeDirs()) {
    if (!isArchive(dir)) paths.add(dir);
  }
  for (const f of [...paths]) {
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i++) paths.add(parts.slice(0, i).join('/'));
  }
  // Displayed count is the subtree total (itself + every descendant folder's
  // sessions), not just what's filed directly in it — a parent folder like
  // "Projects" should read as "everything under here", matching what
  // actually shows up when you drill into it (sessions() already includes
  // the whole subtree via startsWith(folder + '/')). Fine at personal scale
  // (dozens/hundreds of folders) without a fancier trie-based rollup.
  const counts = new Map();
  for (const f of paths) {
    let sum = direct.get(f) || 0;
    for (const [other, n] of direct) {
      if (other !== f && other.startsWith(f + '/')) sum += n;
    }
    counts.set(f, sum);
  }
  return { list: [...paths].sort(), counts, inbox, total };
}

function mapRow(r) {
  return {
    id: r.id,
    source: r.source,
    folder: r.folder,
    startedAt: r.started_at,
    title: r.title,
    summary: r.summary,
    preview: r.preview,
    organizedBy: r.organized_by,
    tags: parseJsonArray(r.tags),
    continuationOf: r.continuation_of,
    continuedTo: parseJsonArray(r.continued_to),
    snippet: r.snippet || null,
  };
}

export function sessions({ folder, query, tags, date } = {}) {
  const searching = !!(query || (tags && tags.length) || date);
  if (searching) {
    // Search (and the calendar's date filter, same rule) stays global
    // regardless of folder — it's how you find something you already filed
    // away without navigating to it first.
    let rows = search({ query, tags: tags || [], folder: folder || undefined, date }).map(mapRow);
    if (folder) rows = rows.filter((r) => r.folder === folder || (r.folder && r.folder.startsWith(folder + '/')));
    return rows;
  }
  // Root (no folder selected) is the literal top level, not "everything" —
  // sessions already filed into a folder live there, not at Root too.
  return listSessions({ folder: folder ? folder : null }).map(mapRow);
}

/** Session counts per day for one calendar month, excluding _archive (same
 * rule folders() already applies to folderCounts()). Map<dayOfMonth, count>. */
export function sessionCountsByDay(year, month) {
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  const counts = new Map();
  for (const { day, folder, n } of dbSessionCountsByDay(yearMonth)) {
    if (isArchive(folder)) continue;
    counts.set(day, (counts.get(day) || 0) + n);
  }
  return counts;
}

export function detail(id) {
  return loadRaw(id);
}

export function tags() {
  return listTags();
}

export function refresh() {
  return reindex();
}

/** Targeted refresh for a single-session mutation (move/tag/resume/edit) —
 * avoids reindex()'s full raw/ reparse + FTS rebuild for the extremely
 * common case where only one session actually changed. */
export function refreshOne(id) {
  const n = loadRaw(id);
  if (n) reindexOne(n);
  else removeFromIndex(id); // raw file is gone — was deleted
}

/** Same, batched over a handful of ids (multi-select move/tag, a suggestion
 * batch, etc.) — still avoids the full-store rebuild. */
export function refreshMany(ids) {
  const found = [];
  for (const id of ids) {
    const n = loadRaw(id);
    if (n) found.push(n);
    else removeFromIndex(id);
  }
  reindexMany(found);
}

function parseJsonArray(s) {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
