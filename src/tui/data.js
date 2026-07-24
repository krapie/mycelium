import { loadRaw } from '../scanner.js';
import { reindex, search, listTags, folderCounts, listSessions } from '../index-db.js';
import { listTreeDirs, isArchive } from '../organize.js';

// Thin data layer the TUI views read from. Folder tree and non-search session
// list are served from the sqlite index (5000+ raw files no longer re-read on
// every render); detail() still loads a single raw file, which is fine.

export function folders() {
  const counts = new Map();
  let inbox = 0;
  let total = 0;
  for (const { folder, n } of folderCounts()) {
    if (isArchive(folder)) continue;
    total += n;
    if (!folder) inbox += n;
    else counts.set(folder, (counts.get(folder) || 0) + n);
  }
  // Include real (possibly empty) tree directories, plus every ancestor path
  // of a session's folder, so nested/empty folders always appear and are
  // selectable for folder operations.
  for (const dir of listTreeDirs()) {
    if (isArchive(dir)) continue;
    if (!counts.has(dir)) counts.set(dir, 0);
  }
  for (const f of [...counts.keys()]) {
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i++) {
      const anc = parts.slice(0, i).join('/');
      if (!counts.has(anc)) counts.set(anc, 0);
    }
  }
  return { list: [...counts.keys()].sort(), counts, inbox, total };
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

export function sessions({ folder, query, tags } = {}) {
  const searching = !!(query || (tags && tags.length));
  if (searching) {
    // Search stays global regardless of folder — it's the one way to find
    // something you already filed away without navigating to it first.
    let rows = search({ query, tags: tags || [], folder: folder || undefined }).map(mapRow);
    if (folder) rows = rows.filter((r) => r.folder === folder || (r.folder && r.folder.startsWith(folder + '/')));
    return rows;
  }
  // Root (no folder selected) is the literal top level, not "everything" —
  // sessions already filed into a folder live there, not at Root too.
  return listSessions({ folder: folder ? folder : null }).map(mapRow);
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

function parseJsonArray(s) {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
