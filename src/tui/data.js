import { allRaw, loadRaw } from '../scanner.js';
import { reindex, search, listTags } from '../index-db.js';

// Thin data layer the TUI views read from — wraps the existing core so views
// never touch sqlite/raw directly.

export function folders() {
  const counts = new Map();
  let inbox = 0;
  let total = 0;
  for (const n of allRaw()) {
    total++;
    if (!n.folder) inbox++;
    else counts.set(n.folder, (counts.get(n.folder) || 0) + 1);
  }
  return { list: [...counts.keys()].sort(), counts, inbox, total };
}

export function sessions({ folder, query, tags } = {}) {
  let rows;
  if (query || (tags && tags.length)) {
    rows = search({ query, tags: tags || [], folder: folder && folder !== '_inbox' ? folder : undefined });
    rows = rows.map((r) => ({
      id: r.id,
      source: r.source,
      folder: r.folder,
      startedAt: r.started_at,
      summary: r.summary,
      preview: r.preview,
      organizedBy: r.organized_by,
      tags: [],
    }));
  } else {
    rows = allRaw()
      .map((n) => ({
        id: n.id,
        source: n.source,
        folder: n.folder,
        startedAt: n.startedAt,
        summary: n.extracted.summary,
        preview: (n.turns.find((t) => t.role === 'user')?.text || '').slice(0, 200),
        organizedBy: n.organizedBy,
        tags: n.extracted.tags,
      }))
      .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
  }
  if (folder === '_inbox') rows = rows.filter((r) => !r.folder);
  else if (folder) rows = rows.filter((r) => r.folder === folder || (r.folder && r.folder.startsWith(folder + '/')));
  return rows;
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
