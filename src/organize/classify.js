import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { TREE_DIR } from '../paths.js';
import { loadRaw, saveRaw, allRaw } from '../scanner.js';
import { listTags } from '../index-db.js';
import { complete, parseJsonReply, mapConcurrent } from '../llm.js';
import { autoTagSession } from '../learn.js';
import { contentLocale } from '../config.js';
import { isArchive, isSuperseded, listTreeDirs, isInSubtree } from './folders.js';
import { move } from './lineage.js';

/** A folder path is safe to mkdir() if every '/'-separated segment is a
 * real name — guards LLM-proposed paths (suggestPlacements()) the same way
 * a human typing into pickFolder()/textPrompt() implicitly never produces
 * '..' or empty segments. */
function isSafeFolderPath(folderPath) {
  if (typeof folderPath !== 'string' || !folderPath.trim()) return false;
  return folderPath.split('/').every((seg) => seg && seg !== '.' && seg !== '..');
}

/**
 * Sessions eligible for content-based (re)classification. `organizedBy ===
 * 'human'` is the one truly sticky state — set by a manual move(), by
 * applyPlacements() once a person has reviewed/confirmed an LLM placement,
 * and by launching `n`/`h` into a folder — so it doubles as "already
 * deliberately placed, leave it alone". Everything else is fair game
 * regardless of its current `folder` — the one exception being `_archive`
 * (excluded below): capture only ever auto-assigns that one folder (an old
 * session's recency-based archive, see scanner.js), and it's meant to stay
 * out of the way. Anything else non-human is either genuinely unfiled or was
 * placed by something that didn't actually decide on its behalf.
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
 *
 * `sessions` lets a caller that already loaded allRaw() for its own purposes
 * (suggestPlacements()'s folderProfiles(), for instance) pass that array in
 * instead of this function doing its own redundant full-store scan — every
 * other caller (pendingSuggestions(), the TUI, tests) omits it and gets the
 * previous behavior unchanged.
 */
export function classificationCandidates({ cooldownMs = 0, folder, sessions } = {}) {
  const now = Date.now();
  return (sessions || allRaw()).filter(
    (n) =>
      n.organizedBy !== 'human' &&
      // _archive is hidden from (re)classification the same way it's hidden
      // from every list/search (index-db.js) — unless the caller is
      // explicitly scoping into it. Without this, capture's auto-archived old
      // backlog (organizedBy:'auto', so otherwise fair game) would get pulled
      // back into every whole-store/New `o` run and re-summarized by the
      // daemon, defeating the point of archiving it.
      (isArchive(folder) || !isArchive(n.folder)) &&
      (!n.lastClassifiedAt || now - Date.parse(n.lastClassifiedAt) >= cooldownMs) &&
      (folder === undefined || (folder === null ? !n.folder : isInSubtree(n.folder, folder))),
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
 * Runs up to `concurrency` at once via mapConcurrent() (llm.js) rather than
 * one at a time — at a real backlog's scale (hundreds/thousands of
 * candidates), a strictly sequential loop makes the wall-clock time scale
 * directly with candidate count. Each candidate writes to its own
 * raw/<id>.json, so there's no file contention; the shared tag vocabulary
 * Set can race harmlessly across concurrent lanes (tag reuse is a quality
 * nicety, not a correctness requirement). Default kept modest (not higher)
 * — each one spawns a real `claude`/`codex` subprocess, and piling up too
 * many at once is exactly what issue #3 was (looked like runaway console
 * windows on Windows).
 *
 * `limit`, sorted oldest-first same as suggestPlacements()/tagAll(), bounds
 * how many candidates get summarized in one call — a large first-time
 * backlog (dozens/hundreds of unfiled sessions) would otherwise mean that
 * many real LLM calls in a single `o` press, easily enough to exhaust a
 * tighter usage quota mid-run (see "session 100% usage" reports). Omit it
 * (default, every caller before this) for the previous unbounded behavior.
 *
 * Also passes `stopAfterConsecutiveFailures` to mapConcurrent() (llm.js,
 * default 3) — once real usage runs out, every subsequent call fails
 * identically, so this stops burning through the rest of `targets` once
 * that's clear rather than one-at-a-time failing through the whole
 * backlog. Whatever already succeeded is untouched either way: each
 * candidate's summary is written to its own raw/<id>.json inside its own
 * try/catch below, so stopping partway through never loses prior
 * progress — press `o` again later to pick up where it left off (the
 * `!n.extracted.summary` filter above already skips everything already
 * done).
 */
export async function summarizeCandidates({ onProgress, concurrency = 3, folder, limit, stopAfterConsecutiveFailures = 3 } = {}) {
  let targets = classificationCandidates({ folder })
    .filter((n) => !n.extracted.summary)
    .sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''));
  if (limit) targets = targets.slice(0, limit);
  // listTags() is sqlite-backed (cheap) — avoids a second full raw/ scan
  // just to derive the same vocabulary classificationCandidates() already
  // paid for once above.
  const vocab = new Set(listTags().map((t) => t.name));
  let done = 0;
  let failed = 0;

  const { stoppedEarly } = await mapConcurrent(
    targets,
    concurrency,
    async (n) => {
      try {
        const res = await autoTagSession(n.id, { existingTags: [...vocab] });
        if (res.ok) {
          done++;
          for (const t of res.session.extracted.tags) vocab.add(t);
          if (onProgress) onProgress(res.session);
          return { ok: true };
        }
        failed++;
        if (onProgress) onProgress(null, new Error(res.error));
        return { ok: false };
      } catch (err) {
        failed++;
        if (onProgress) onProgress(null, err);
        return { ok: false };
      }
    },
    { stopAfterConsecutiveFailures },
  );
  return { done, failed, total: targets.length, stoppedEarly };
}

/**
 * folder -> profile text a candidate session gets compared against. Prefers
 * an existing KNOWLEDGE.md (already a human-reviewed, LLM-compressed digest
 * of that folder — see insight.js's `w`) over concatenating every session
 * summary in the folder: shorter prompts, and arguably better signal since
 * it's already synthesized rather than a raw dump. Falls back to the most
 * recent 15 summaries only when no KNOWLEDGE.md exists yet, capped so a
 * folder with hundreds of sessions doesn't blow the prompt up on its own.
 *
 * Takes the already-loaded session array rather than calling allRaw()
 * itself — suggestPlacements() (its only caller) loads the store once and
 * shares it with classificationCandidates() too, instead of two independent
 * full raw/ scans before any LLM call happens.
 */
function folderProfiles(sessions) {
  const byFolder = new Map();
  for (const n of sessions) {
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
 *
 * Chunks now run through mapConcurrent() (llm.js) — up to `concurrency`
 * chunks' complete() calls in flight at once (default 3, same governing
 * ceiling as summarizeCandidates()/tagAll(), so peak concurrent
 * `claude`/`codex` subprocesses stays the same regardless of which call
 * site triggered it). Each chunk still batches up to `batchSize` sessions
 * into one prompt, so concurrency bounds chunks in flight, not raw session
 * count.
 *
 * A chunk failing no longer discards every other chunk's already-computed
 * placements (a real bug: quota exhaustion partway through used to mean
 * `{ok:false}` with the successful chunks' work silently thrown away).
 * `error` is now set alongside `ok:true, placements` when some chunks
 * failed but others didn't — `ok:false` only when nothing usable came back
 * at all. `stopAfterConsecutiveFailures` (mapConcurrent(), default 3) stops
 * scheduling new chunks once that many fail in a row (real usage
 * exhaustion makes every subsequent call fail identically) rather than
 * burning through every remaining chunk one at a time; chunks already in
 * flight still finish and get stamped/collected.
 */
// Korean branch is the original prompt, unchanged — see contentLocale()
// (config.js). `folderBlock`/`sessionBlock` are already fully built by the
// caller in the target language (see foldersBlockText()/sessionsBlockText()
// below), so this only needs to localize its own instructional text.
function placementPrompt(folderBlock, sessionBlock, locale) {
  if (locale === 'ko') {
    return `아래는 이미 사람이 정리해 둔 폴더들과 그 안 세션 요약이다.

${folderBlock}

---
다음은 재분류가 필요한 세션들이다. 각 세션이 위 폴더 중 어디와 주제/성격이 가장 비슷한지 판단해라.
- 잘 맞는 기존 폴더가 있으면 그 폴더 경로를 그대로 써라.
- 기존 폴더 중 맞는 게 없지만 현재폴더의 뚜렷이 구분되는 하위 주제라면 새 폴더 경로를 제안해도 된다(예: 현재폴더가 "회사/서버"이고 이 세션이 "로깅"에 관한 것이면 "회사/서버/로깅"처럼 하위에 새로 만들 폴더명을 제안).
- 그래도 애매하면 folder를 null로 해라.
${sessionBlock}

출력 형식(JSON만, 다른 설명 없이):
{"placements":[{"id":"...", "folder":"..."|null, "reason":"짧은 이유"}]}`;
  }
  return `Below are the folders a human has already organized, and the session summaries inside each.

${folderBlock}

---
Below are sessions that need (re)classifying. For each one, judge which of the above folders is the closest match by topic/nature.
- If an existing folder fits well, use that exact folder path.
- If no existing folder fits but the session is a clearly distinct sub-topic of its current folder, you may propose a new folder path (e.g. if the current folder is "company/server" and this session is about "logging", propose "company/server/logging" as a new subfolder name).
- If it's still ambiguous, set folder to null.
${sessionBlock}

Output format (JSON only, no other explanation):
{"placements":[{"id":"...", "folder":"..."|null, "reason":"short reason"}]}`;
}

export async function suggestPlacements({
  onProgress,
  batchSize = 25,
  limit,
  cooldownMs = 0,
  folder,
  concurrency = 3,
  stopAfterConsecutiveFailures = 3,
} = {}) {
  const locale = contentLocale();
  const allSessions = allRaw();
  const profiles = folderProfiles(allSessions);
  let candidates = classificationCandidates({ cooldownMs, folder, sessions: allSessions })
    .filter((n) => n.extracted.summary)
    .sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''));
  if (limit) candidates = candidates.slice(0, limit);
  if (!candidates.length) return { ok: true, placements: [] };

  const folderLabel = locale === 'ko' ? '폴더' : 'Folder';
  const folderBlock = profiles.size
    ? [...profiles.entries()].map(([folder, text]) => `${folderLabel}: ${folder}\n${text}`).join('\n\n')
    : locale === 'ko'
      ? '(아직 정리된 폴더 없음)'
      : '(no folders organized yet)';
  const known = new Set(profiles.keys());
  const existingDirs = new Set(listTreeDirs());
  const placements = [];
  const chunks = [];
  for (let i = 0; i < candidates.length; i += batchSize) chunks.push(candidates.slice(i, i + batchSize));

  let firstError = null;
  let completedChunks = 0;
  const { stoppedEarly } = await mapConcurrent(
    chunks,
    concurrency,
    async (chunk) => {
      // Current folder (if any) is given as a hint — even a session already
      // sitting somewhere might belong to a sub-topic of that same folder.
      const sessionBlock = chunk
        .map((n) =>
          locale === 'ko'
            ? `- id:${n.id} 현재폴더:${n.folder || '(없음)'} 요약:${n.extracted.summary}`
            : `- id:${n.id} current folder:${n.folder || '(none)'} summary:${n.extracted.summary}`,
        )
        .join('\n');
      const prompt = placementPrompt(folderBlock, sessionBlock, locale);

      let reply;
      try {
        reply = await complete(prompt);
      } catch (err) {
        if (!firstError) firstError = `LLM failed: ${err.message}`;
        return { ok: false };
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
      completedChunks++;
      if (onProgress) onProgress(completedChunks, chunks.length);
      return { ok: true };
    },
    { stopAfterConsecutiveFailures },
  );
  // Partial success: a chunk failing partway through (quota exhaustion is
  // the real-world case — see summarizeCandidates()'s doc comment above)
  // used to discard every OTHER chunk's already-computed placements along
  // with it. Whatever did come back stays usable; only report ok:false
  // when literally nothing useful resulted from this call.
  if (firstError && !placements.length) return { ok: false, error: firstError, stoppedEarly };
  return { ok: true, placements, error: firstError || undefined, stoppedEarly };
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
    .filter((n) => folder === undefined || (folder === null ? !n.folder : isInSubtree(n.folder, folder)))
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
