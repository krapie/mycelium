import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { TREE_DIR } from '../paths.js';
import { loadRaw, saveRaw, allRaw } from '../scanner.js';
import { complete, parseJsonReply } from '../llm.js';
import { autoTagSession } from '../learn.js';
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
 * Runs in `concurrency`-sized chunks rather than one at a time — at a real
 * backlog's scale (hundreds/thousands of candidates), a strictly sequential
 * loop makes the wall-clock time scale directly with candidate count. Each
 * candidate writes to its own raw/<id>.json, so there's no file contention;
 * the shared tag vocabulary Set can race harmlessly within a chunk (tag
 * reuse is a quality nicety, not a correctness requirement). Default kept
 * modest (not higher) — each one spawns a real `claude`/`codex` subprocess,
 * and piling up too many at once is exactly what issue #3 was (looked like
 * runaway console windows on Windows).
 */
export async function summarizeCandidates({ onProgress, concurrency = 3, folder } = {}) {
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
