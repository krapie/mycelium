import { rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOME, TREE_DIR, RAW_DIR, DB_PATH, ensureDirs } from './paths.js';
import { allRaw, purgeMeta } from './scanner.js';
import { reindex } from './index-db.js';

/** Remove tree directories that hold no sessions in their whole subtree. */
export function pruneEmptyFolders() {
  ensureDirs();
  const used = new Set();
  for (const n of allRaw()) {
    if (!n.folder) continue;
    const parts = n.folder.split('/');
    for (let i = 1; i <= parts.length; i++) used.add(parts.slice(0, i).join('/'));
  }
  let removed = 0;
  const walk = (dir, rel) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (r === '_inbox' || r === '_archive') continue;
      walk(join(dir, e.name), r);
      if (!used.has(r) && existsSync(join(dir, e.name))) {
        rmSync(join(dir, e.name), { recursive: true, force: true });
        removed++;
      }
    }
  };
  walk(TREE_DIR, '');
  return removed;
}

/** Delete sessions currently filed under _archive (dead-cwd / noise) from the store. */
export function clearArchive() {
  let removed = 0;
  for (const f of readdirSync(RAW_DIR)) {
    if (!f.endsWith('.json')) continue;
    const p = join(RAW_DIR, f);
    try {
      const n = JSON.parse(readFileSync(p, 'utf8'));
      if (n.folder === '_archive' || (n.folder && n.folder.startsWith('_archive/'))) {
        rmSync(p);
        removed++;
      }
    } catch {
      /* skip */
    }
  }
  const arch = join(TREE_DIR, '_archive');
  if (existsSync(arch)) rmSync(arch, { recursive: true, force: true });
  return removed;
}

/** Drop and rebuild the sqlite index from raw/ (files are the source of truth). */
export function rebuildIndex() {
  for (const p of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) if (existsSync(p)) rmSync(p);
  return reindex();
}

/** Safe tidy: remove Mycelium's own LLM-call sessions, prune empty folders, reindex. */
export function tidy() {
  const meta = purgeMeta();
  const folders = pruneEmptyFolders();
  const indexed = rebuildIndex();
  return { meta, folders, indexed };
}

/** Wipe the entire ~/.mycelium data store (irreversible — re-scan to rebuild). */
export function resetStore() {
  if (existsSync(HOME)) rmSync(HOME, { recursive: true, force: true });
  ensureDirs();
  return HOME;
}
