import { join } from 'node:path';
import { basename } from 'node:path';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
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
 * Decide the folder for a session from its cwd — deterministic, no LLM.
 * 1) first matching config rule (prefix → folder) wins
 * 2) else group by repo: projects/<basename-of-cwd>
 * 3) else null (→ _inbox), e.g. sessions with no cwd
 */
export function autoFolderFor(neutral, cfg = loadConfig()) {
  if (!neutral.cwd) return null;
  for (const rule of cfg.cwdRules || []) {
    if (neutral.cwd === rule.prefix || neutral.cwd.startsWith(rule.prefix + '/')) {
      return rule.folder;
    }
  }
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

/** cwd→folder rule so future sessions from a path auto-file into a chosen folder. */
export function addRule(prefix, folder) {
  const cfg = loadConfig();
  cfg.cwdRules = cfg.cwdRules || [];
  cfg.cwdRules = cfg.cwdRules.filter((r) => r.prefix !== prefix);
  cfg.cwdRules.push({ prefix, folder });
  saveConfig(cfg);
  return cfg.cwdRules;
}
