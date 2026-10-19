/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CLIPS_DIR, ensureDirs } from './paths.js';
import { loadRaw } from './scanner.js';
import { isBacklog } from './schema.js';
import { isInSubtree } from './organize.js';

/**
 * Clips: one part of a captured conversation (a single turn, or a short
 * range) a person pinned to keep verbatim — the unit between a whole session
 * (too coarse to find one answer in later) and KNOWLEDGE.md (an LLM summary,
 * not the original text).
 *
 * Stored in their own clips/<id>.json, NOT as a session `kind` the way
 * backlog.js does it: a backlog item stands in for a session that doesn't
 * exist yet, so it belongs in the session list; a clip is a piece OF a
 * session, and as session rows they'd crowd the list and need an isBacklog()-
 * style guard in every summary/digest/classify path.
 *
 * The pinned turns are copied, not just referenced by index — deleting,
 * merging, or splitting the source session must not empty a clip someone
 * deliberately kept. `sessionId` stays as provenance, and to follow the
 * session's folder if it's moved later (see clipFolder()).
 */

function clipPath(id) {
  return join(CLIPS_DIR, `${id}.json`);
}

/**
 * Pin turns `from`..`to` (1-based, inclusive — the numbers `mycelium clip add
 * <session>` prints) of `sessionId`.
 */
export function createClip({ sessionId, from, to = from, note = '' } = {}) {
  const n = loadRaw(sessionId);
  if (!n) return { ok: false, error: `no session ${sessionId}` };
  if (isBacklog(n)) return { ok: false, error: 'a backlog item has no conversation to clip' };
  const total = n.turns.length;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > total) {
    return { ok: false, error: `turn range must be within 1-${total}` };
  }
  ensureDirs();
  const clip = {
    id: randomUUID(),
    sessionId: n.id,
    source: n.source,
    folder: n.folder ?? null,
    sessionTitle: n.extracted.title || null,
    from,
    to,
    turns: n.turns.slice(from - 1, to).map((t) => ({ role: t.role, text: t.text })),
    note: (note || '').trim() || null,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(clipPath(clip.id), JSON.stringify(clip, null, 2));
  return { ok: true, clip };
}

/** The source session's CURRENT folder if it still exists, else the folder
 * it had when pinned — so moving a session (`m`) carries its clips along. */
export function clipFolder(c) {
  const n = loadRaw(c.sessionId);
  return n ? n.folder ?? null : c.folder;
}

/** Clips, newest first. `folder` scopes like listBacklog() (undefined =
 * everywhere, null = only unfiled, a path = that subtree); `sessionId`
 * narrows to one session's clips. */
export function listClips({ folder, sessionId } = {}) {
  if (!existsSync(CLIPS_DIR)) return [];
  return readdirSync(CLIPS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(CLIPS_DIR, f), 'utf8'));
      } catch {
        return null; // a half-written/corrupt file shouldn't hide every other clip
      }
    })
    .filter(Boolean)
    .filter((c) => (sessionId ? c.sessionId === sessionId : true))
    .filter((c) => {
      if (folder === undefined) return true;
      const f = clipFolder(c);
      if (folder === null) return !f;
      return isInSubtree(f, folder);
    })
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

/** Exact id or a unique prefix, same contract as scanner.js's findSession(). */
export function findClip(idOrPrefix) {
  const all = listClips();
  const exact = all.find((c) => c.id === idOrPrefix);
  if (exact) return { ok: true, clip: exact };
  const matches = all.filter((c) => c.id.startsWith(idOrPrefix));
  if (matches.length === 0) return { ok: false, error: `no clip matching "${idOrPrefix}"` };
  if (matches.length > 1) return { ok: false, error: `ambiguous prefix "${idOrPrefix}" — ${matches.length} matches; use more characters` };
  return { ok: true, clip: matches[0] };
}

export function deleteClip(id) {
  const p = clipPath(id);
  if (!existsSync(p)) return { ok: false, error: `no clip ${id}` };
  rmSync(p);
  return { ok: true };
}

/** Plain text of a clip's turns, `[role] text` per turn — what the CLI
 * prints and what knowledge.js hands the LLM. */
export function clipText(c) {
  return c.turns.map((t) => `[${t.role}] ${t.text}`).join('\n\n');
}
