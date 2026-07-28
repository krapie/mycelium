import { join } from 'node:path';
import { mkdirSync, existsSync, readFileSync, renameSync, rmSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureDirs, TREE_DIR } from './paths.js';
import { loadRaw, saveRaw, allRaw, deleteRaw } from './scanner.js';
import { loadConfig, saveConfig } from './config.js';
import { complete, parseJsonReply } from './llm.js';
import { autoTagSession } from './learn.js';
import { emptyNeutral } from './schema.js';

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

/** A folder path is safe to mkdir() if every '/'-separated segment is a
 * real name — guards LLM-proposed paths (suggestPlacements()) the same way
 * a human typing into pickFolder()/textPrompt() implicitly never produces
 * '..' or empty segments. */
function isSafeFolderPath(folderPath) {
  if (typeof folderPath !== 'string' || !folderPath.trim()) return false;
  return folderPath.split('/').every((seg) => seg && seg !== '.' && seg !== '..');
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
 * here touches ~/.claude or ~/.codex). Setting a non-empty title locks it —
 * autoTagSession() (learn.js) checks `titleLocked` and never overwrites a
 * human's deliberate choice, on this or any future run. Clearing the title
 * (empty string) unlocks it again, so the next auto-tag fills it back in.
 * Summary always refreshes on the next `a` regardless, same as if this had
 * never run.
 */
export function setContent(sessionId, { title, summary } = {}) {
  const n = loadRaw(sessionId);
  if (!n) return { ok: false, error: `no session ${sessionId}` };
  if (typeof title === 'string') {
    n.extracted.title = title.trim() || null;
    n.titleLocked = !!n.extracted.title;
  }
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
  // Sweep other sessions' backlinks to the now-gone id — continuation/merge/
  // split arrays render.js reads for the ↩/→/🔀/⤳ markers and detail links.
  // A dangling entry doesn't crash anything (those lookups already degrade
  // to just showing the bare id), but it's stale bookkeeping worth cleaning
  // while we're already touching this id — same discipline unmerge()/
  // unsplit() apply to their own fields.
  const touchedIds = [];
  for (const other of allRaw()) {
    let touched = false;
    if (other.continuedTo?.includes(sessionId)) {
      other.continuedTo = other.continuedTo.filter((id) => id !== sessionId);
      touched = true;
    }
    if (other.mergedFrom?.includes(sessionId)) {
      other.mergedFrom = other.mergedFrom.filter((id) => id !== sessionId);
      touched = true;
    }
    if (other.supersededBy?.includes(sessionId)) {
      other.supersededBy = other.supersededBy.filter((id) => id !== sessionId);
      touched = true;
    }
    if (other.splitInto?.includes(sessionId)) {
      other.splitInto = other.splitInto.filter((id) => id !== sessionId);
      touched = true;
    }
    if (touched) {
      saveRaw(other);
      touchedIds.push(other.id);
    }
  }
  // Callers should reindex touchedIds too (e.g. via data.refreshMany), not
  // just sessionId itself — their on-disk backlinks changed here as well.
  return { ok: true, id: sessionId, touchedIds };
}

/**
 * Sessions eligible for content-based (re)classification. `organizedBy ===
 * 'human'` is the one truly sticky state — set by a manual move(), by
 * applyPlacements() once a person has reviewed/confirmed an LLM placement,
 * and by launching `n`/`h` into a folder — so it doubles as "already
 * deliberately placed, leave it alone". Everything else is fair game
 * regardless of its current `folder` — capture itself never assigns one, so
 * anything non-human is either genuinely unfiled or was placed by something
 * that didn't actually decide on its behalf.
 *
 * `cooldownMs` skips sessions classified too recently — without it, a
 * session the LLM couldn't confidently place keeps getting re-sent to it
 * every cycle forever (real cost, no resolution). 0 (the default) means no
 * cooldown, appropriate for an explicit human-triggered run.
 *
 * `folder` restricts to that folder's subtree — same semantics as
 * index-db.js's listSessions()/data.sessions() (undefined = whole store,
 * null = only genuinely-unfiled, a path = itself + descendants). This is
 * what lets a TUI review scoped to "wherever I'm currently browsing" (Root
 * or a specific folder) instead of always sweeping the entire store.
 */
export function classificationCandidates({ cooldownMs = 0, folder } = {}) {
  const now = Date.now();
  return allRaw().filter(
    (n) =>
      n.organizedBy !== 'human' &&
      (!n.lastClassifiedAt || now - Date.parse(n.lastClassifiedAt) >= cooldownMs) &&
      (folder === undefined || (folder === null ? !n.folder : n.folder === folder || n.folder?.startsWith(folder + '/'))),
  );
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
export async function summarizeCandidates({ onProgress, concurrency = 5, folder } = {}) {
  const targets = classificationCandidates({ folder }).filter((n) => !n.extracted.summary);
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
    if (!n.folder || isArchive(n.folder) || isSuperseded(n) || !n.extracted.summary) continue;
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
 * Content-based folder suggestions — the only mechanism that assigns a
 * folder now that capture doesn't (see classificationCandidates() above).
 * Chunks candidates into `batchSize`-sized groups (one
 * complete() call per chunk, folder-profile text built once and reused
 * across chunks) instead of one call with every candidate — a single
 * mega-prompt doesn't scale to a real backlog (the prompt grows without
 * bound in candidate count). Pure suggestion — nothing is moved until
 * applyPlacements(). Callers should run summarizeCandidates() first so the
 * candidates actually have summaries to compare; folders lacking summaries
 * just yield thinner profiles rather than blocking this.
 *
 * `cooldownMs`/`folder` are forwarded straight to classificationCandidates()
 * — see its doc comment. `limit` bounds how many candidates get considered
 * in one call (oldest first), so a daemon cycle — or the first-ever manual
 * run against a large backlog — can chip away gradually instead of
 * classifying everything at once.
 *
 * Each candidate the LLM actually looked at (regardless of outcome) gets
 * `lastClassifiedAt` stamped, so an unresolved session isn't re-sent to the
 * LLM again until classificationCandidates()'s cooldown clears — otherwise a
 * session nothing fits would get re-classified (real cost, no resolution)
 * on every single call forever.
 *
 * `folder` restricts which candidates get considered (classificationCandidates()'s
 * subtree semantics) — the comparison set of existing folders (folderProfiles()
 * below) is always the whole store regardless, since a session scoped to one
 * folder can still legitimately belong somewhere else entirely.
 */
export async function suggestPlacements({ onProgress, batchSize = 25, limit, cooldownMs = 0, folder } = {}) {
  const profiles = folderProfiles();
  let candidates = classificationCandidates({ cooldownMs, folder })
    .filter((n) => n.extracted.summary)
    .sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''));
  if (limit) candidates = candidates.slice(0, limit);
  if (!candidates.length) return { ok: true, placements: [] };

  const folderBlock = profiles.size
    ? [...profiles.entries()].map(([folder, text]) => `폴더: ${folder}\n${text}`).join('\n\n')
    : '(아직 정리된 폴더 없음)';
  const known = new Set(profiles.keys());
  const existingDirs = new Set(listTreeDirs());
  const placements = [];
  const chunks = [];
  for (let i = 0; i < candidates.length; i += batchSize) chunks.push(candidates.slice(i, i + batchSize));

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    // 현재 폴더(있다면)를 힌트로 같이 준다 — 이미 어딘가 들어가 있는
    // 세션이라도 그 폴더의 하위 주제일 수 있으니 참고만 하라는 뜻.
    const sessionBlock = chunk
      .map((n) => `- id:${n.id} 현재폴더:${n.folder || '(없음)'} 요약:${n.extracted.summary}`)
      .join('\n');
    const prompt = `아래는 이미 사람이 정리해 둔 폴더들과 그 안 세션 요약이다.

${folderBlock}

---
다음은 재분류가 필요한 세션들이다. 각 세션이 위 폴더 중 어디와 주제/성격이 가장 비슷한지 판단해라.
- 잘 맞는 기존 폴더가 있으면 그 폴더 경로를 그대로 써라.
- 기존 폴더 중 맞는 게 없지만 현재폴더의 뚜렷이 구분되는 하위 주제라면 새 폴더 경로를 제안해도 된다(예: 현재폴더가 "회사/서버"이고 이 세션이 "로깅"에 관한 것이면 "회사/서버/로깅"처럼 하위에 새로 만들 폴더명을 제안).
- 그래도 애매하면 folder를 null로 해라.
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
      const folder = known.has(p.folder) || isSafeFolderPath(p.folder) ? p.folder : null;
      placements.push({ id: p.id, folder, reason: p.reason || '', isNew: !!folder && !existingDirs.has(folder) });
    }
    // Stamp every candidate the LLM actually saw this round, matched or
    // not — "already asked" is what the cooldown needs, independent of the
    // outcome.
    const now = new Date().toISOString();
    for (const n of chunk) {
      n.lastClassifiedAt = now;
      saveRaw(n);
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
 * suggestPlacements() returns. `folder` scopes by each session's CURRENT
 * folder (classificationCandidates()'s subtree semantics) — not the
 * suggested target, which is the returned `folder` field's meaning. */
export function pendingSuggestions({ folder } = {}) {
  return allRaw()
    .filter((n) => n.suggestedFolder)
    .filter((n) => folder === undefined || (folder === null ? !n.folder : n.folder === folder || n.folder?.startsWith(folder + '/')))
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
 * organizedBy:'human'), so a placement that was just reviewed and confirmed
 * won't come back up as a classification candidate later.
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

/**
 * Rename or re-nest a folder: rewrite the path prefix on every session under it
 * (preserving each session's organizedBy — this is a structural move, not a
 * re-filing) and move the real directory (with its KNOWLEDGE.md).
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

/**
 * Fold a merge/split product's content into a REAL session a handoff from
 * it just produced, then delete the product. The product only ever existed
 * to seed that real session in the first place — once a real, directly
 * resumable session exists, there's no reason to keep a second row around
 * for what's really one thread of work. `newId` keeps its own real
 * agent-native id, so from here on it's a completely ordinary session (no
 * special-casing needed — plain `r` just resumes it like anything else).
 */
export function foldProductIntoSession(productId, newId) {
  const product = loadRaw(productId);
  const target = loadRaw(newId);
  if (!product || !target) return { ok: false, error: 'session not found' };
  target.turns = [
    { role: 'system', text: `─── ${product.source} #${productId.slice(0, 8)} · ${(product.startedAt || '').slice(0, 16).replace('T', ' ')} ───` },
    ...product.turns,
    ...target.turns,
  ];
  target.startedAt = product.startedAt || target.startedAt;
  target.artifacts.filesChanged = [...new Set([...(product.artifacts.filesChanged || []), ...(target.artifacts.filesChanged || [])])];
  // linkContinuation() just pointed the new session back at the product —
  // clear it, since the product is about to stop existing as its own record
  // and the new session is meant to look like a completely ordinary session
  // from here on, not one with a dangling "continues: (gone)" marker.
  if (target.continuationOf === productId) target.continuationOf = null;
  saveRaw(target);
  const del = deleteSession(productId);
  return { ok: true, target, touchedIds: del.touchedIds || [] };
}

/**
 * Merge N sessions into one new synthetic session — the *only* place their
 * turns are combined; the originals are never touched (see split.js's
 * module doc for why: scan() only carries forward extracted/folder/
 * organizedBy/continuation* on re-import, not turns, so rewriting an
 * existing id's turns in place would be unrecoverable on the next scan).
 * `mergedFrom` on the new record and `supersededBy` on each original are the
 * only link — fully reversible via unmerge().
 */
export function mergeSessions(ids, { title } = {}) {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length < 2) return { ok: false, error: '병합하려면 세션을 2개 이상 선택하세요' };
  const originals = uniqueIds.map(loadRaw).filter(Boolean);
  if (originals.length < 2) return { ok: false, error: '유효한 세션을 찾을 수 없습니다' };
  originals.sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''));

  const merged = emptyNeutral(randomUUID(), 'merged');
  merged.startedAt = originals[0].startedAt;
  merged.endedAt = originals[originals.length - 1].endedAt;
  merged.mergedFrom = originals.map((n) => n.id);
  if (title) merged.extracted.title = title;
  // Each block is preceded by a plain-text separator (role 'system' — not
  // produced by any adapter, so it can't be mistaken for a real user turn by
  // firstUserText()/handoff's turn lookups) noting provenance, same spirit
  // as sessionToText()'s multi-section export.
  merged.turns = originals.flatMap((n) => [
    { role: 'system', text: `─── ${n.source} #${n.id.slice(0, 8)} · ${(n.startedAt || '').slice(0, 16).replace('T', ' ')} ───` },
    ...n.turns,
  ]);
  merged.artifacts.filesChanged = [...new Set(originals.flatMap((n) => n.artifacts.filesChanged || []))];
  saveRaw(merged);

  for (const n of originals) {
    n.supersededBy = [merged.id];
    saveRaw(n);
  }
  return { ok: true, merged, originals };
}

/** Reverse of mergeSessions(): delete the synthetic record, restore the originals' visibility. */
export function unmerge(mergedId) {
  const merged = loadRaw(mergedId);
  if (!merged) return { ok: false, error: `no session ${mergedId}` };
  if (!merged.mergedFrom?.length) return { ok: false, error: '병합된 세션이 아닙니다' };
  const restored = [];
  for (const id of merged.mergedFrom) {
    const n = loadRaw(id);
    if (!n) continue;
    n.supersededBy = (n.supersededBy || []).filter((x) => x !== mergedId);
    saveRaw(n);
    restored.push(n);
  }
  deleteRaw(mergedId);
  return { ok: true, restored };
}

