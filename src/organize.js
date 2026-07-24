import { join } from 'node:path';
import { basename } from 'node:path';
import { mkdirSync, existsSync, readFileSync, renameSync, rmSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ensureDirs, TREE_DIR } from './paths.js';
import { loadRaw, saveRaw, allRaw, deleteRaw } from './scanner.js';
import { loadConfig, saveConfig } from './config.js';
import { complete, parseJsonReply } from './llm.js';
import { autoTagSession } from './learn.js';

// _archive (dead-cwd sessions, or anything manually filed there) is deliberately
// hidden from the TUI by default — it's a bin for things you don't want in
// your way, not a folder you browse. Still fully there on disk; reachable via
// `mycelium list --folder _archive` / `mycelium search --folder _archive`.
export function isArchive(folder) {
  return folder === '_archive' || (!!folder && folder.startsWith('_archive/'));
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
 * Set title/summary MANUALLY — Mycelium's own record only, never the
 * original agent's log (see reuse.js/injectAgentsMd for the one place
 * Mycelium writes outside its own store, and note this is not that: nothing
 * here touches ~/.claude or ~/.codex). A hand-set title sticks the same way
 * an auto-generated one does — autoTagSession() (learn.js) only protects a
 * non-empty title, it doesn't distinguish how that title got there. Summary
 * always refreshes on the next `a`, same as if this had never run.
 */
export function setContent(sessionId, { title, summary } = {}) {
  const n = loadRaw(sessionId);
  if (!n) return { ok: false, error: `no session ${sessionId}` };
  if (typeof title === 'string') n.extracted.title = title.trim() || null;
  if (typeof summary === 'string') n.extracted.summary = summary.trim() || null;
  saveRaw(n);
  return { ok: true, session: n };
}

/**
 * Delete a session from Mycelium ONLY — removes it from raw/ (and therefore
 * the derived sqlite index on next reindex), but never touches the original
 * ~/.claude or ~/.codex session log, same boundary as setContent() above.
 * That source file staying on disk means a plain rescan would just re-import
 * the "deleted" session right back, so its id also goes on a persistent
 * exclude list in config.json that scan() checks before re-capturing.
 */
export function deleteSession(sessionId) {
  const n = loadRaw(sessionId);
  if (!n) return { ok: false, error: `no session ${sessionId}` };
  deleteRaw(sessionId);
  const cfg = loadConfig();
  const excluded = new Set(cfg.excludedSessionIds || []);
  excluded.add(sessionId);
  cfg.excludedSessionIds = [...excluded];
  saveConfig(cfg);
  return { ok: true, id: sessionId };
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

/** Sessions still unplaced and not explicitly parked there by a human. */
function unorganizedCandidates() {
  return allRaw().filter((n) => !n.folder && n.organizedBy !== 'human');
}

/**
 * Summarize only the unorganized candidates that lack one — deliberately
 * narrower than learn.js's tagAll(), which would also touch already-foldered
 * sessions across the whole store. A folder whose existing sessions haven't
 * been summarized yet just contributes fewer/no profile examples below;
 * that backlog belongs to the regular `a`/autotag flow, not to a side effect
 * of classifying the handful of sessions actually still unorganized.
 *
 * Runs in `concurrency`-sized chunks rather than one at a time — at a real
 * backlog's scale (hundreds/thousands of candidates), a strictly sequential
 * loop makes the wall-clock time scale directly with candidate count. Each
 * candidate writes to its own raw/<id>.json, so there's no file contention;
 * the shared tag vocabulary Set can race harmlessly within a chunk (tag
 * reuse is a quality nicety, not a correctness requirement).
 */
export async function summarizeCandidates({ onProgress, concurrency = 5 } = {}) {
  const targets = unorganizedCandidates().filter((n) => !n.extracted.summary);
  const vocab = new Set(allRaw().flatMap((n) => n.extracted.tags || []));
  let done = 0;
  let failed = 0;

  const runOne = async (n) => {
    try {
      const res = await autoTagSession(n.id, { existingTags: [...vocab] });
      if (res.ok) {
        done++;
        for (const t of res.session.extracted.tags) vocab.add(t);
        if (onProgress) onProgress(res.session);
      } else {
        failed++;
        if (onProgress) onProgress(null, new Error(res.error));
      }
    } catch (err) {
      failed++;
      if (onProgress) onProgress(null, err);
    }
  };

  for (let i = 0; i < targets.length; i += concurrency) {
    await Promise.all(targets.slice(i, i + concurrency).map(runOne));
  }
  return { done, failed, total: targets.length };
}

/**
 * folder -> profile text a candidate session gets compared against. Prefers
 * an existing KNOWLEDGE.md (already a human-reviewed, LLM-compressed digest
 * of that folder — see insight.js's `w`) over concatenating every session
 * summary in the folder: shorter prompts, and arguably better signal since
 * it's already synthesized rather than a raw dump. Falls back to the most
 * recent 15 summaries only when no KNOWLEDGE.md exists yet, capped so a
 * folder with hundreds of sessions doesn't blow the prompt up on its own.
 */
function folderProfiles() {
  const byFolder = new Map();
  for (const n of allRaw()) {
    if (!n.folder || isArchive(n.folder) || !n.extracted.summary) continue;
    if (!byFolder.has(n.folder)) byFolder.set(n.folder, []);
    byFolder.get(n.folder).push(n);
  }
  const profiles = new Map();
  for (const [folder, sessions] of byFolder) {
    const kPath = join(TREE_DIR, ...folder.split('/'), 'KNOWLEDGE.md');
    if (existsSync(kPath)) {
      profiles.set(folder, readFileSync(kPath, 'utf8').trim());
    } else {
      const recent = sessions
        .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
        .slice(0, 15)
        .map((n) => `- ${n.extracted.summary}`)
        .join('\n');
      profiles.set(folder, recent);
    }
  }
  return profiles;
}

/**
 * Content-based folder suggestions for unorganized sessions — the LLM
 * alternative to autoFolderFor()'s cwd-prefix rules. Chunks candidates into
 * `batchSize`-sized groups (one complete() call per chunk, folder-profile
 * text built once and reused across chunks) instead of one call with every
 * candidate — a single mega-prompt doesn't scale to a real backlog (the
 * prompt grows without bound in candidate count). Pure suggestion — nothing
 * is moved until applyPlacements(). Callers should run summarizeCandidates()
 * first so the candidates actually have summaries to compare; folders
 * lacking summaries just yield thinner profiles rather than blocking this.
 * `limit` bounds how many candidates get considered in one call (oldest
 * first), so a daemon cycle can chip away at a large backlog gradually
 * instead of trying to classify all of it in one run.
 */
export async function suggestPlacements({ onProgress, batchSize = 25, limit } = {}) {
  const profiles = folderProfiles();
  let candidates = unorganizedCandidates()
    .filter((n) => n.extracted.summary)
    .sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''));
  if (limit) candidates = candidates.slice(0, limit);
  if (!profiles.size || !candidates.length) return { ok: true, placements: [] };

  const folderBlock = [...profiles.entries()].map(([folder, text]) => `폴더: ${folder}\n${text}`).join('\n\n');
  const known = new Set(profiles.keys());
  const placements = [];
  const chunks = [];
  for (let i = 0; i < candidates.length; i += batchSize) chunks.push(candidates.slice(i, i + batchSize));

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const sessionBlock = chunk.map((n) => `- id:${n.id} 요약:${n.extracted.summary}`).join('\n');
    const prompt = `아래는 이미 사람이 정리해 둔 폴더들과 그 안 세션 요약이다.

${folderBlock}

---
다음은 아직 분류되지 않은 세션들이다. 각 세션이 위 폴더 중 어디와 주제/성격이 가장 비슷한지 판단하고, 맞는 폴더가 없으면 folder를 null로 해라.
${sessionBlock}

출력 형식(JSON만, 다른 설명 없이):
{"placements":[{"id":"...", "folder":"..."|null, "reason":"짧은 이유"}]}`;

    let reply;
    try {
      reply = await complete(prompt);
    } catch (err) {
      return { ok: false, error: `LLM failed: ${err.message}` };
    }
    const parsed = parseJsonReply(reply);
    for (const p of parsed?.placements || []) {
      if (!chunk.some((c) => c.id === p.id)) continue;
      placements.push({ id: p.id, folder: known.has(p.folder) ? p.folder : null, reason: p.reason || '' });
    }
    if (onProgress) onProgress(i + 1, chunks.length);
  }
  return { ok: true, placements };
}

/** Queue computed placements onto the session records themselves, so they
 * survive across daemon cycles / process restarts — the TUI's `o` key and
 * `mycelium organize --smart` both check this before recomputing. */
export function queueSuggestions(placements) {
  let queued = 0;
  for (const p of placements) {
    if (!p.folder) continue;
    const n = loadRaw(p.id);
    if (!n) continue;
    n.suggestedFolder = p.folder;
    n.suggestedReason = p.reason || '';
    saveRaw(n);
    queued++;
  }
  return queued;
}

/** Sessions with a queued-but-not-yet-reviewed suggestion, in the same shape
 * suggestPlacements() returns. */
export function pendingSuggestions() {
  return allRaw()
    .filter((n) => n.suggestedFolder)
    .map((n) => ({ id: n.id, folder: n.suggestedFolder, reason: n.suggestedReason || '' }));
}

/** Clear queued suggestions after they've been reviewed (applied or
 * explicitly passed on) — reviewed items shouldn't keep nagging. */
export function clearSuggestions(ids) {
  for (const id of ids) {
    const n = loadRaw(id);
    if (!n) continue;
    n.suggestedFolder = null;
    n.suggestedReason = null;
    saveRaw(n);
  }
}

/**
 * Apply accepted placements — same effect as a manual `m` move (sticky,
 * organizedBy:'human'), so the next daemon cwd-rule pass won't reshuffle a
 * placement that was just reviewed and confirmed.
 */
export function applyPlacements(placements) {
  let applied = 0;
  for (const p of placements) {
    if (!p.folder) continue;
    const res = move(p.id, p.folder);
    if (res.ok) applied++;
  }
  return applied;
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
  updateRuleFolders((f) => (f === oldPath ? newPath : f && f.startsWith(oldPath + '/') ? newPath + f.slice(oldPath.length) : f));

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
    if (n.folder === folderPath || (n.folder && n.folder.startsWith(folderPath + '/'))) {
      n.folder = reassignTo;
      saveRaw(n);
      affected.push(n);
    }
  }
  updateRuleFolders((f) => (f === folderPath || (f && f.startsWith(folderPath + '/')) ? null : f));
  const dir = folderDir(folderPath);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  return { ok: true, moved: affected.length, reassignTo, affected };
}

/** Record that `childId` is a handoff continuation of `parentId` (links both ways). */
export function linkContinuation(childId, parentId) {
  if (childId === parentId) return;
  const child = loadRaw(childId);
  if (child) {
    child.continuationOf = parentId;
    saveRaw(child);
  }
  const parent = loadRaw(parentId);
  if (parent) {
    parent.continuedTo = parent.continuedTo || [];
    if (!parent.continuedTo.includes(childId)) parent.continuedTo.push(childId);
    saveRaw(parent);
  }
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
