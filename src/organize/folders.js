import { join, dirname } from 'node:path';
import { mkdirSync, existsSync, renameSync, rmSync, readdirSync } from 'node:fs';
import { ensureDirs, TREE_DIR } from '../paths.js';
import { saveRaw, allRaw } from '../scanner.js';

// _archive (anything manually filed there) is deliberately hidden from the
// TUI by default — it's a bin for things you don't want in your way, not a
// folder you browse. Still fully there on disk; reachable via
// `mycelium list --folder _archive` / `mycelium search --folder _archive`.
export function isArchive(folder) {
  return folder === '_archive' || (!!folder && folder.startsWith('_archive/'));
}

// A session folded into a merge/split product is hidden the same way
// _archive is — its content now lives in the product that superseded it.
export function isSuperseded(n) {
  return !!(n.supersededBy && n.supersededBy.length);
}

/**
 * Is `sessionFolder` exactly `scopeFolder`, or somewhere in its subtree?
 * The one folder-scope test repeated independently across organize.js,
 * index-db.js, and insight.js — `folder === X || folder?.startsWith(X + '/')`.
 * Callers still handle the separate "folder is undefined/null" meanings
 * themselves (this only covers the "folder is a concrete path" case).
 */
export function isInSubtree(sessionFolder, scopeFolder) {
  return sessionFolder === scopeFolder || (!!sessionFolder && sessionFolder.startsWith(scopeFolder + '/'));
}

/** Real directory for a tree path like "회사/플랫폼/인증". */
function folderDir(folderPath) {
  return join(TREE_DIR, ...folderPath.split('/'));
}

export function mkdir(folderPath) {
  ensureDirs();
  const dir = folderDir(folderPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return folderPath;
}

/**
 * All real folder directories under the tree (recursively), as '/'-joined
 * paths — including empty ones that hold no sessions yet. This is what lets a
 * freshly-created folder show up in the UI before anything is filed into it.
 */
export function listTreeDirs() {
  ensureDirs();
  const out = [];
  const walk = (absDir, rel) => {
    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (rel === '' && e.name === '_inbox') continue; // virtual folder
      const path = rel ? `${rel}/${e.name}` : e.name;
      out.push(path);
      walk(join(absDir, e.name), path);
    }
  };
  walk(TREE_DIR, '');
  return out;
}

/**
 * Rename or re-nest a folder: rewrite the path prefix on every session under it
 * (preserving each session's organizedBy — this is a structural move, not a
 * re-filing) and move the real directory (with its KNOWLEDGE.md).
 * `moveFolder` is just a rename into a new parent.
 */
export function renameFolder(oldPath, newPath) {
  if (!oldPath || !newPath || oldPath === newPath) return { ok: false, error: '잘못된 경로' };
  if (isInSubtree(newPath, oldPath)) return { ok: false, error: '자기 자신/하위로는 옮길 수 없습니다' };

  const affected = [];
  for (const n of allRaw()) {
    if (n.folder === oldPath) {
      n.folder = newPath;
      saveRaw(n);
      affected.push(n);
    } else if (n.folder && n.folder.startsWith(oldPath + '/')) {
      n.folder = newPath + n.folder.slice(oldPath.length);
      saveRaw(n);
      affected.push(n);
    }
  }
  const from = folderDir(oldPath);
  const to = folderDir(newPath);
  if (existsSync(from)) {
    mkdirSync(dirname(to), { recursive: true });
    // On case-insensitive filesystems (default on macOS/Windows), `from` and
    // `to` can resolve to the very same directory when the rename only
    // changes case (vpc -> VPC). existsSync(to) then reports true even though
    // nothing else is really there, so the old code deleted the folder being
    // renamed and then failed to rename it (ENOENT). Route case-only renames
    // through a throwaway name so the destructive-overwrite branch below only
    // ever runs against a genuinely different, pre-existing folder.
    if (from.toLowerCase() === to.toLowerCase() && from !== to) {
      const tmp = `${from}.__mycelium_rename_${Date.now()}`;
      renameSync(from, tmp);
      renameSync(tmp, to);
    } else {
      if (existsSync(to)) rmSync(to, { recursive: true, force: true });
      renameSync(from, to);
    }
  } else {
    mkdir(newPath);
  }
  return { ok: true, from: oldPath, to: newPath, affected };
}

/** Delete a folder: reassign its sessions (default → _inbox) and remove the dir. */
export function deleteFolder(folderPath, { reassignTo = null } = {}) {
  if (!folderPath) return { ok: false, error: '잘못된 경로' };
  const affected = [];
  for (const n of allRaw()) {
    if (isInSubtree(n.folder, folderPath)) {
      n.folder = reassignTo;
      saveRaw(n);
      affected.push(n);
    }
  }
  const dir = folderDir(folderPath);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  return { ok: true, moved: affected.length, reassignTo, affected };
}
