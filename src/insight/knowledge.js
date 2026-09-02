import { join } from 'node:path';
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { complete, mapConcurrent } from '../llm.js';
import { allRaw } from '../scanner.js';
import { TREE_DIR, ensureDirs } from '../paths.js';
import { isSuperseded, isInSubtree, listTreeDirs } from '../organize.js';
import { contentLocale } from '../config.js';
import { sessionsForPeriod } from './digest.js';

/**
 * Folders with at least one FILED session (unfiled/`_inbox` sessions are
 * deliberately excluded — a knowledge summary of an unsorted catch-all isn't
 * meaningful) that started on `date`. Used by proposeKnowledgeRefreshes()
 * (below) to decide which folders get a knowledge-refresh proposal — see
 * that function and docs/features.md for the full flow. Independent of
 * digest.js's generateDigest()/the Digest feature — this is a separate
 * concept (`k`, not `d`), it just happens to reuse the same day-filter
 * helper (sessionsForPeriod, digest.js).
 */
export function foldersActiveOn(date) {
  const sessions = sessionsForPeriod('day', date).filter((s) => s.folder);
  return [...new Set(sessions.map((s) => s.folder))];
}

// Caps how much material one knowledge-extraction prompt can carry.
// Unbounded before this — every non-superseded session's summary +
// decisions in the whole subtree got concatenated with no limit at all,
// and this runs once per ACTIVE FOLDER EVERY DAY (proposeKnowledgeRefreshes()),
// so a long-lived folder's prompt only ever grows. Most-recent-first
// (what a folder's knowledge should weight toward), whole-item budget
// rather than a mid-line truncation like learn.js's sessionExcerpt() —
// that's fine for one continuous transcript, but chopping a bullet list
// mid-item would hand the model a broken line.
const KNOWLEDGE_MATERIAL_BUDGET = 7000;
function knowledgeMaterial(sessions, locale, decisionLabel, noSummary) {
  const ordered = [...sessions].sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
  const kept = [];
  let used = 0;
  let omitted = 0;
  for (const s of ordered) {
    const parts = [`- ${s.extracted.summary || noSummary}`];
    for (const d of s.extracted.decisions || []) parts.push(`  · ${decisionLabel}: ${d}`);
    const block = parts.join('\n');
    if (kept.length && used + block.length > KNOWLEDGE_MATERIAL_BUDGET) {
      omitted++;
      continue;
    }
    kept.push(block);
    used += block.length + 1;
  }
  const material = kept.join('\n');
  if (!omitted) return material;
  const marker =
    locale === 'ko' ? `…(오래된 세션 ${omitted}개는 분량 제한으로 생략)…` : `…(${omitted} older session${omitted === 1 ? '' : 's'} omitted to fit)…`;
  return `${material}\n${marker}`;
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

  const material = knowledgeMaterial(sessions, locale, decisionLabel, noSummary);

  // Korean branch is the original prompt, unchanged — see contentLocale()
  // (config.js).
  const prompt =
    locale === 'ko'
      ? `아래는 "${folder}" 작업 공간에서 있었던 세션 요약과 결정들이다. 이 공간에서 새 작업을 시작하는 AI가 미리 알아야 할 "프로젝트 지식"을 정리해라. 반복되는 컨벤션, 확정된 결정, 자주 나오는 용어, 주의할 점 위주로. 개별 세션 나열이 아니라 정제된 지식으로.

구조: 찾은 내용을 다음 "##" 제목 아래에, 이 순서로 정리해라 — 실제로 쓸 내용이 있는 제목만 넣어라: ## 컨벤션, ## 결정, ## 용어, ## 주의할 점. 하나만 내용이 있으면 그 하나만 출력해라. 제목만 쓰고 내용을 비우거나 "없음" 같은 채움말을 넣지 마라. 최상위 "#" 제목은 쓰지 마라 — 네 출력 위에 이미 하나 붙는다.
각 줄은 이 세션들을 읽지 않은 사람도 바로 이해하고 적용할 수 있어야 한다. 여러 세션에 반복해서 나오는 내용은 한 줄로 합치고, 한 세션에만 해당하고 다시 나오지 않을 내용은 빼라.
전체 400단어 이내. 이 글은 이 작업 공간의 모든 다음 세션 컨텍스트에 그대로 실리므로, 길이 자체가 비용이다.

금지: "완료했습니다", "정리하여 저장했습니다", "다음 작업 시 참고됩니다" 같은
작업 보고/메타 서술로 시작하거나 끝내지 마라. 이 출력은 다음 세션의
AGENTS.md에 그대로 주입될 지식 본문이지, 방금 한 일에 대한 리포트가
아니다. 첫 줄부터 바로 실제 지식(컨벤션/결정/용어)으로 시작해라.
한국어 마크다운 본문만 출력.

${material}`
      : `Below are the session summaries and decisions from the "${folder}" workspace. Distill the "project knowledge" an AI starting new work in this space should already know — recurring conventions, settled decisions, frequently-used terms, and things to watch out for. Not a list of individual sessions — refined knowledge instead.

Structure: organize what you find under these "##" headings, in this order, and include a heading only when you actually have something real for it: ## Conventions, ## Decisions, ## Terminology, ## Watch out for. If only one has content, output only that one. Never write a heading followed by nothing, or by filler like "none". Do not emit a top-level "#" heading — one is already added above your output.
Every line must stand on its own for someone who never read these sessions. Merge anything that recurs across sessions into a single line; drop anything that applied to one session only and will not come up again.
Under 400 words total. This text is loaded into the context of every future session in this workspace, so length is a real cost to the reader.

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
 * (sessions-actions.js), computing fresh for TODAY the moment a human
 * presses it — the expected, primary path — and the daemon's independent
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
