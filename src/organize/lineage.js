import { randomUUID } from 'node:crypto';
import { loadRaw, saveRaw, allRaw, deleteRaw } from '../scanner.js';
import { loadConfig, saveConfig } from '../config.js';
import { emptyNeutral } from '../schema.js';
import { mkdir } from './folders.js';

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
 *
 * Setting a non-empty title ALSO marks the session organizedBy:'human' —
 * same sticky flag move()/tag()/applyPlacements() already set the moment a
 * person makes a deliberate decision about a session. Without this, a
 * session that landed in a folder via auto-classification (never went
 * through the reviewed `o` → apply flow, so organizedBy stayed non-human)
 * stayed "fair game" for classificationCandidates() — a LATER `o` press
 * (even one scoped to a totally different folder) or the background daemon
 * cycle could silently re-classify it, including back to unfiled, with
 * nothing about renaming it having signaled "leave this one alone." One-way
 * like every other organizedBy write in this file — clearing the title
 * unlocks the title again but does not un-human the session.
 */
export function setContent(sessionId, { title, summary } = {}) {
  const n = loadRaw(sessionId);
  if (!n) return { ok: false, error: `no session ${sessionId}` };
  if (typeof title === 'string') {
    n.extracted.title = title.trim() || null;
    n.titleLocked = !!n.extracted.title;
    if (n.titleLocked) n.organizedBy = 'human';
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
  // split arrays render.js reads for the "Continues:"/"Merged from:"/etc.
  // markers and detail links.
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
  // Land in the shared folder rather than unfiled, when there is one — a
  // merge is a deliberate human action on already-placed sessions, same
  // reasoning applySplit() already uses for its own pieces ("not left
  // unfiled... land where the original was"). Ambiguous when the originals
  // don't agree (different folders, or any of them unfiled) — falls back
  // to unfiled rather than guessing which one should win.
  const folders = new Set(originals.map((n) => n.folder || null));
  if (folders.size === 1 && [...folders][0]) {
    merged.folder = [...folders][0];
    merged.organizedBy = 'human';
  }
  // Propagate demo:true so tutorial.js's endTutorial() sweep (which only
  // matches that flag) still catches the merge product — without this, a
  // merge inside the tutorial/mycelium demo leaves a real-looking orphaned
  // session behind after cleanup, in the real ~/.mycelium store for the
  // first-run tutorial path (not just the throwaway ~/.mycelium-demo one).
  if (originals.some((n) => n.demo)) merged.demo = true;
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
