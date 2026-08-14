import { join } from 'node:path';
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { complete, mapConcurrent } from './llm.js';
import { allRaw } from './scanner.js';
import { TREE_DIR, DIGEST_DIR, ensureDirs } from './paths.js';
import { isSuperseded, isInSubtree, listTreeDirs } from './organize.js';
import { firstUserTurn } from './schema.js';
import { contentLocale } from './config.js';

function dayOf(iso) {
  return iso ? iso.slice(0, 10) : null;
}

function isoWeek(iso) {
  const d = new Date(iso);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function groupByFolder(sessions) {
  const by = new Map();
  for (const s of sessions) {
    const f = s.folder || '_inbox';
    if (!by.has(f)) by.set(f, []);
    by.get(f).push(s);
  }
  return by;
}

/** Sessions started on/in a given day or ISO week — the filter generateDigest()
 * and foldersActiveOn() both need, pulled out so the two stay in sync. */
function sessionsForPeriod(period, target) {
  const keyed = period === 'week' ? isoWeek(`${target}T00:00:00Z`) : target;
  return allRaw().filter((s) => {
    if (!s.startedAt) return false;
    return period === 'week' ? isoWeek(s.startedAt) === keyed : dayOf(s.startedAt) === target;
  });
}

/**
 * Folders with at least one FILED session (unfiled/`_inbox` sessions are
 * deliberately excluded — a knowledge summary of an unsorted catch-all isn't
 * meaningful) that started on `date`. Used by proposeKnowledgeRefreshes()
 * (below) to decide which folders get a knowledge-refresh proposal — see
 * that function and docs/features.md for the full flow. Independent of
 * generateDigest()/the Digest feature — this is a separate concept (`k`,
 * not `d`), it just happens to reuse the same day-filter helper.
 */
export function foldersActiveOn(date) {
  const sessions = sessionsForPeriod('day', date).filter((s) => s.folder);
  return [...new Set(sessions.map((s) => s.folder))];
}

/**
 * Narrative digest for a period. Reuses the per-session summaries that
 * auto-tagging already produced (no re-reading full transcripts — cheap), and
 * asks the LLM to write it the way a colleague's handoff note reads, grouped by
 * folder. memory-journal-mcp is the only surveyed tool with a scheduled digest,
 * but it only works in a long-running HTTP server; here the daemon owns the
 * schedule and this is a plain function it calls.
 */
export async function generateDigest({ period = 'day', date } = {}) {
  ensureDirs();
  const locale = contentLocale();
  const noSummary = locale === 'ko' ? '(요약 없음)' : '(no summary)';
  const target = date || new Date().toISOString().slice(0, 10);
  const keyed = period === 'week' ? isoWeek(`${target}T00:00:00Z`) : target;

  const sessions = sessionsForPeriod(period, target);

  if (sessions.length === 0) return { ok: false, error: `no sessions for ${keyed}` };

  const byFolder = groupByFolder(sessions);
  const blocks = [];
  for (const [folder, ss] of byFolder) {
    const items = ss
      .map((s) => `- [${folder}] ${s.extracted.summary || firstUserTurn(s)?.text?.slice(0, 80) || noSummary}`)
      .join('\n');
    blocks.push(items);
  }

  // Korean branch is the original prompt, unchanged — see contentLocale()
  // (config.js).
  const prompt =
    locale === 'ko'
      ? `아래는 ${keyed} 기간 동안의 AI 작업 세션 요약 목록이다(폴더별). 이걸 사람이 아침에 읽는 인수인계 메모처럼 서사형으로 정리해라. 상태 카운트 말고, 무슨 일이 있었고 무엇이 결정됐고 뭐가 남았는지 3~6문장. 한국어.

${blocks.join('\n')}

출력은 마크다운 본문만.`
      : `Below is a list of AI work session summaries (by folder) for the period ${keyed}. Write these up narratively, the way a colleague's morning handoff note reads. Not a status count — 3-6 sentences on what happened, what was decided, and what's left.

${blocks.join('\n')}

Output markdown body only.`;

  let narrative;
  try {
    narrative = await complete(prompt);
  } catch (err) {
    return { ok: false, error: locale === 'ko' ? `LLM 실패: ${err.message}` : `LLM failed: ${err.message}` };
  }

  const md =
    locale === 'ko'
      ? `# ${keyed} 다이제스트\n\n${narrative.trim()}\n\n---\n\n## 세션 (${sessions.length})\n\n${[...byFolder]
          .map(([f, ss]) => `### ${f}\n${ss.map((s) => `- ${s.extracted.summary || noSummary}`).join('\n')}`)
          .join('\n\n')}\n`
      : `# ${keyed} Digest\n\n${narrative.trim()}\n\n---\n\n## Sessions (${sessions.length})\n\n${[...byFolder]
          .map(([f, ss]) => `### ${f}\n${ss.map((s) => `- ${s.extracted.summary || noSummary}`).join('\n')}`)
          .join('\n\n')}\n`;

  const path = join(DIGEST_DIR, `${keyed}.md`);
  writeFileSync(path, md);
  return { ok: true, path, keyed, count: sessions.length };
}

/**
 * Generate durable Project Knowledge for a folder from its sessions' summaries
 * and decisions — an LLM call, but does NOT write anything to disk. Split from
 * writeKnowledge() so the TUI can show the human the proposed KNOWLEDGE.md
 * (which becomes AGENTS.md content for every future session in that folder)
 * and let them confirm before it's saved, rather than trusting LLM output
 * blindly. Follows ai-memory's "compile-not-retrieve": a coherent page, not
 * raw logs.
 */
export async function buildKnowledgeText(folder) {
  const locale = contentLocale();
  const noSummary = locale === 'ko' ? '(요약 없음)' : '(no summary)';
  const decisionLabel = locale === 'ko' ? '결정' : 'Decision';
  const sessions = allRaw().filter((s) => {
    if (isSuperseded(s)) return false; // its content now lives in the merge/split product instead
    const f = s.folder || '_inbox';
    return isInSubtree(f, folder);
  });
  if (sessions.length === 0) return { ok: false, error: `no sessions in ${folder}` };

  const material = sessions
    .map((s) => {
      const parts = [`- ${s.extracted.summary || noSummary}`];
      for (const d of s.extracted.decisions || []) parts.push(`  · ${decisionLabel}: ${d}`);
      return parts.join('\n');
    })
    .join('\n');

  // Korean branch is the original prompt, unchanged — see contentLocale()
  // (config.js).
  const prompt =
    locale === 'ko'
      ? `아래는 "${folder}" 작업 공간에서 있었던 세션 요약과 결정들이다. 이 공간에서 새 작업을 시작하는 AI가 미리 알아야 할 "프로젝트 지식"을 정리해라. 반복되는 컨벤션, 확정된 결정, 자주 나오는 용어, 주의할 점 위주로. 개별 세션 나열이 아니라 정제된 지식으로.

금지: "완료했습니다", "정리하여 저장했습니다", "다음 작업 시 참고됩니다" 같은
작업 보고/메타 서술로 시작하거나 끝내지 마라. 이 출력은 다음 세션의
AGENTS.md에 그대로 주입될 지식 본문이지, 방금 한 일에 대한 리포트가
아니다. 첫 줄부터 바로 실제 지식(컨벤션/결정/용어)으로 시작해라.
한국어 마크다운 본문만 출력.

${material}`
      : `Below are the session summaries and decisions from the "${folder}" workspace. Distill the "project knowledge" an AI starting new work in this space should already know — recurring conventions, settled decisions, frequently-used terms, and things to watch out for. Not a list of individual sessions — refined knowledge instead.

Forbidden: don't open or close with a status-report/meta phrase like "Done", "Organized and saved", "This will be referenced in future work". This output is knowledge that gets injected verbatim into the next session's AGENTS.md, not a report on what you just did. Start from the very first line with the actual knowledge (conventions/decisions/terms) itself.
Output markdown body only.

${material}`;

  let knowledge;
  try {
    knowledge = await complete(prompt);
  } catch (err) {
    return { ok: false, error: locale === 'ko' ? `LLM 실패: ${err.message}` : `LLM failed: ${err.message}` };
  }

  const text = `# ${folder} — Project Knowledge\n\n${knowledge.trim()}\n`;
  return { ok: true, folder, count: sessions.length, text };
}

/** Write already-generated (and, in the TUI, human-confirmed) knowledge text to disk. */
export function writeKnowledgeText(folder, text) {
  ensureDirs();
  const dir = join(TREE_DIR, ...folder.split('/'));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, 'KNOWLEDGE.md');
  writeFileSync(path, text);
  return { ok: true, path, folder };
}

function pendingKnowledgePath(folder) {
  return join(TREE_DIR, ...folder.split('/'), 'KNOWLEDGE.pending.md');
}

/**
 * Stage an LLM-generated knowledge proposal without touching the real
 * KNOWLEDGE.md — written by proposeKnowledgeRefreshes() (below), called
 * either by the daemon's independent knowledgeReviewCycle or by the TUI's
 * `k` command computing fresh on demand, reviewed by a human via `k`, and
 * only promoted to KNOWLEDGE.md on explicit approval (promoteKnowledge()
 * below). The file's mere existence IS the review queue — no separate
 * store, same "plain file is the state" approach the rest of this codebase
 * uses.
 */
export function writePendingKnowledgeText(folder, text) {
  ensureDirs();
  const dir = join(TREE_DIR, ...folder.split('/'));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = pendingKnowledgePath(folder);
  writeFileSync(path, text);
  return { ok: true, path, folder };
}

/** Folders currently carrying an unreviewed knowledge proposal, with its text. */
export function pendingKnowledgeReviews() {
  return listTreeDirs()
    .filter((folder) => existsSync(pendingKnowledgePath(folder)))
    .map((folder) => ({ folder, text: readFileSync(pendingKnowledgePath(folder), 'utf8') }));
}

/** Approve a pending proposal: promote it to the real KNOWLEDGE.md, then
 * clear the pending file so it stops showing up for review. */
export function promoteKnowledge(folder) {
  const path = pendingKnowledgePath(folder);
  if (!existsSync(path)) return { ok: false, error: `no pending knowledge for ${folder}` };
  const text = readFileSync(path, 'utf8');
  const w = writeKnowledgeText(folder, text);
  rmSync(path);
  return w;
}

/** Reject a pending proposal without promoting it — a later manual `w` can
 * always regenerate one from scratch, so this just stops the nagging. */
export function dismissPendingKnowledge(folder) {
  const path = pendingKnowledgePath(folder);
  if (existsSync(path)) rmSync(path);
  return { ok: true, folder };
}

/**
 * Stage a knowledge-refresh proposal (see writePendingKnowledgeText() above)
 * for every folder active on `date` that doesn't already have an unreviewed
 * one — same buildKnowledgeText() LLM call a manual `w` press makes, just
 * computed here so a review is instant once someone actually looks. Two
 * callers, both wanting the exact same behavior: the TUI's `k` command
 * (sessions.js), computing fresh for TODAY the moment a human presses it —
 * the expected, primary path — and the daemon's independent
 * knowledgeReviewCycle (daemon/cycles.js), computing for YESTERDAY once a
 * day, as the fallback for whenever a human didn't. Sharing this one
 * function (rather than daemon/cycles.js owning its own copy) is what makes
 * "did a human trigger this, or did Mycelium do it for them overnight"
 * produce an identical result either way — the actual bug fixed by moving
 * this here.
 *
 * Skips a folder with an existing unreviewed proposal (avoids both
 * clobbering something not yet looked at and duplicate LLM spend). Bounded
 * by `limit` (default `MYCELIUM_DIGEST_KNOWLEDGE_LIMIT`, same "gradual
 * drain" reasoning as smart-organize's own batch limit) and `concurrency`
 * (default `MYCELIUM_SUMMARIZE_CONCURRENCY` — the same shared ceiling every
 * other daemon-triggered batch of LLM calls uses, see issue #3) — both
 * env-defaulted here rather than by each caller, so a human-triggered `k`
 * press is bound by the exact same safety limits an overnight cycle is.
 */
export async function proposeKnowledgeRefreshes(date, {
  concurrency = Number(process.env.MYCELIUM_SUMMARIZE_CONCURRENCY || 3),
  limit = Number(process.env.MYCELIUM_DIGEST_KNOWLEDGE_LIMIT || 10),
} = {}) {
  const alreadyPending = new Set(pendingKnowledgeReviews().map((p) => p.folder));
  const folders = foldersActiveOn(date)
    .filter((f) => !alreadyPending.has(f))
    .slice(0, limit);
  if (!folders.length) return { proposed: 0, failed: [] };
  let proposed = 0;
  const failed = [];
  await mapConcurrent(folders, concurrency, async (folder) => {
    try {
      const gen = await buildKnowledgeText(folder);
      if (gen.ok) {
        writePendingKnowledgeText(folder, gen.text);
        proposed++;
      } else {
        // buildKnowledgeText() already catches its own LLM failure and
        // resolves ok:false rather than throwing.
        failed.push({ folder, error: gen.error });
      }
    } catch (err) {
      failed.push({ folder, error: err.message });
    }
  });
  return { proposed, failed };
}

/**
 * Generate + write in one call, no confirmation — used by the CLI
 * (`mycelium knowledge <folder>`) and any non-interactive caller where
 * there's no human to ask.
 */
export async function extractKnowledge(folder) {
  const gen = await buildKnowledgeText(folder);
  if (!gen.ok) return gen;
  const w = writeKnowledgeText(folder, gen.text);
  return { ok: true, path: w.path, folder, count: gen.count };
}

/** Every distinct folder that currently has sessions (for batch knowledge extraction). */
export function foldersWithSessions() {
  const set = new Set();
  for (const s of allRaw()) if (s.folder) set.add(s.folder);
  return [...set];
}
