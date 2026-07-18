import { join } from 'node:path';
import { basename } from 'node:path';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, rmSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ensureDirs, TREE_DIR, CONFIG_PATH } from './paths.js';
import { loadRaw, saveRaw, allRaw } from './scanner.js';

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return { cwdRules: [] };
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return { cwdRules: [] };
  }
}

function saveConfig(cfg) {
  ensureDirs();
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
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
 * Decide the folder for a session from its cwd — deterministic, no LLM.
 * 1) first matching config rule (prefix → folder) wins
 * 2) cwd no longer exists (e.g. a deleted git worktree) → _archive
 * 3) else group by repo: projects/<basename-of-cwd>
 * 4) else null (→ _inbox), e.g. sessions with no cwd
 */
export function autoFolderFor(neutral, cfg = loadConfig()) {
  if (!neutral.cwd) return null;
  for (const rule of cfg.cwdRules || []) {
    if (neutral.cwd === rule.prefix || neutral.cwd.startsWith(rule.prefix + '/')) {
      return rule.folder;
    }
  }
  // Dead working dirs (worktrees removed, temp dirs gone) are noise — cluster
  // them in one _archive folder instead of littering projects/ with them.
  if (!existsSync(neutral.cwd)) return '_archive';
  const base = basename(neutral.cwd);
  return base ? `projects/${base}` : null;
}

/** Move a session to a folder MANUALLY — marks it human-owned (sticky). */
export function move(sessionId, folderPath) {
  const n = loadRaw(sessionId);
  if (!n) return { ok: false, error: `no session ${sessionId}` };
  if (folderPath) mkdir(folderPath);
  n.folder = folderPath || null;
  n.organizedBy = 'human';
  saveRaw(n);
  return { ok: true, session: n };
}

/** Add/remove tags MANUALLY — also marks the session human-owned. */
export function tag(sessionId, add = [], remove = []) {
  const n = loadRaw(sessionId);
  if (!n) return { ok: false, error: `no session ${sessionId}` };
  const set = new Set(n.extracted.tags || []);
  for (const t of remove) set.delete(t);
  for (const t of add) set.add(t);
  n.extracted.tags = [...set];
  n.organizedBy = 'human';
  saveRaw(n);
  return { ok: true, session: n };
}

/**
 * Auto-organize every session that a human hasn't touched. Sessions marked
 * organizedBy:'human' are never moved — the sticky rule that keeps automation
 * from undoing a person's manual filing. Returns counts.
 */
export function autoOrganize() {
  const cfg = loadConfig();
  let placed = 0;
  let skippedHuman = 0;
  for (const n of allRaw()) {
    if (n.organizedBy === 'human') {
      skippedHuman++;
      continue;
    }
    const folder = autoFolderFor(n, cfg);
    if (folder) mkdir(folder);
    if (n.folder !== folder) {
      n.folder = folder;
      saveRaw(n);
      placed++;
    }
  }
  return { placed, skippedHuman };
}

function updateRuleFolders(map) {
  const cfg = loadConfig();
  let changed = false;
  for (const r of cfg.cwdRules || []) {
    const next = map(r.folder);
    if (next !== r.folder) {
      if (next === null) r._drop = true;
      else r.folder = next;
      changed = true;
    }
  }
  if (changed) {
    cfg.cwdRules = (cfg.cwdRules || []).filter((r) => !r._drop);
    saveConfig(cfg);
  }
}

/**
 * Rename or re-nest a folder: rewrite the path prefix on every session under it
 * (preserving each session's organizedBy — this is a structural move, not a
 * re-filing), move the real directory (with its KNOWLEDGE.md), and fix cwd rules.
 * `moveFolder` is just a rename into a new parent.
 */
export function renameFolder(oldPath, newPath) {
  if (!oldPath || !newPath || oldPath === newPath) return { ok: false, error: '잘못된 경로' };
  if (newPath === oldPath || newPath.startsWith(oldPath + '/')) return { ok: false, error: '자기 자신/하위로는 옮길 수 없습니다' };

  for (const n of allRaw()) {
    if (n.folder === oldPath) {
      n.folder = newPath;
      saveRaw(n);
    } else if (n.folder && n.folder.startsWith(oldPath + '/')) {
      n.folder = newPath + n.folder.slice(oldPath.length);
      saveRaw(n);
    }
  }
  updateRuleFolders((f) => (f === oldPath ? newPath : f && f.startsWith(oldPath + '/') ? newPath + f.slice(oldPath.length) : f));

  const from = folderDir(oldPath);
  const to = folderDir(newPath);
  if (existsSync(from)) {
    mkdirSync(dirname(to), { recursive: true });
    if (existsSync(to)) rmSync(to, { recursive: true, force: true });
    renameSync(from, to);
  } else {
    mkdir(newPath);
  }
  return { ok: true, from: oldPath, to: newPath };
}

/** Delete a folder: reassign its sessions (default → _inbox) and remove the dir. */
export function deleteFolder(folderPath, { reassignTo = null } = {}) {
  if (!folderPath) return { ok: false, error: '잘못된 경로' };
  let moved = 0;
  for (const n of allRaw()) {
    if (n.folder === folderPath || (n.folder && n.folder.startsWith(folderPath + '/'))) {
      n.folder = reassignTo;
      saveRaw(n);
      moved++;
    }
  }
  updateRuleFolders((f) => (f === folderPath || (f && f.startsWith(folderPath + '/')) ? null : f));
  const dir = folderDir(folderPath);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  return { ok: true, moved, reassignTo };
}

/** Reverse of a cwd rule: the working directory configured for a folder, if any. */
export function cwdForFolder(folder) {
  const cfg = loadConfig();
  const rule = (cfg.cwdRules || []).find((r) => r.folder === folder);
  return rule ? rule.prefix : null;
}

/** cwd→folder rule so future sessions from a path auto-file into a chosen folder. */
export function addRule(prefix, folder) {
  const cfg = loadConfig();
  cfg.cwdRules = cfg.cwdRules || [];
  cfg.cwdRules = cfg.cwdRules.filter((r) => r.prefix !== prefix);
  cfg.cwdRules.push({ prefix, folder });
  saveConfig(cfg);
  return cfg.cwdRules;
}
