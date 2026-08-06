import { join } from 'node:path';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { complete } from './llm.js';
import { allRaw } from './scanner.js';
import { TREE_DIR, DIGEST_DIR, ensureDirs } from './paths.js';
import { isSuperseded, isInSubtree } from './organize.js';
import { firstUserTurn } from './schema.js';

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
  const target = date || new Date().toISOString().slice(0, 10);
  const keyed = period === 'week' ? isoWeek(`${target}T00:00:00Z`) : target;

  const sessions = allRaw().filter((s) => {
    if (!s.startedAt) return false;
    return period === 'week' ? isoWeek(s.startedAt) === keyed : dayOf(s.startedAt) === target;
  });

  if (sessions.length === 0) return { ok: false, error: `no sessions for ${keyed}` };

  const byFolder = groupByFolder(sessions);
  const blocks = [];
  for (const [folder, ss] of byFolder) {
    const items = ss
      .map((s) => `- [${folder}] ${s.extracted.summary || firstUserTurn(s)?.text?.slice(0, 80) || '(요약 없음)'}`)
      .join('\n');
    blocks.push(items);
  }

  const prompt = `아래는 ${keyed} 기간 동안의 AI 작업 세션 요약 목록이다(폴더별). 이걸 사람이 아침에 읽는 인수인계 메모처럼 서사형으로 정리해라. 상태 카운트 말고, 무슨 일이 있었고 무엇이 결정됐고 뭐가 남았는지 3~6문장. 한국어.

${blocks.join('\n')}

출력은 마크다운 본문만.`;

  let narrative;
  try {
    narrative = await complete(prompt);
  } catch (err) {
    return { ok: false, error: `LLM 실패: ${err.message}` };
  }

  const md = `# ${keyed} 다이제스트\n\n${narrative.trim()}\n\n---\n\n## 세션 (${sessions.length})\n\n${[...byFolder]
    .map(([f, ss]) => `### ${f}\n${ss.map((s) => `- ${s.extracted.summary || '(요약 없음)'}`).join('\n')}`)
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
  const sessions = allRaw().filter((s) => {
    if (isSuperseded(s)) return false; // its content now lives in the merge/split product instead
    const f = s.folder || '_inbox';
    return isInSubtree(f, folder);
  });
  if (sessions.length === 0) return { ok: false, error: `no sessions in ${folder}` };

  const material = sessions
    .map((s) => {
      const parts = [`- ${s.extracted.summary || '(요약 없음)'}`];
      for (const d of s.extracted.decisions || []) parts.push(`  · 결정: ${d}`);
      return parts.join('\n');
    })
    .join('\n');

  const prompt = `아래는 "${folder}" 작업 공간에서 있었던 세션 요약과 결정들이다. 이 공간에서 새 작업을 시작하는 AI가 미리 알아야 할 "프로젝트 지식"을 정리해라. 반복되는 컨벤션, 확정된 결정, 자주 나오는 용어, 주의할 점 위주로. 개별 세션 나열이 아니라 정제된 지식으로.

금지: "완료했습니다", "정리하여 저장했습니다", "다음 작업 시 참고됩니다" 같은
작업 보고/메타 서술로 시작하거나 끝내지 마라. 이 출력은 다음 세션의
AGENTS.md에 그대로 주입될 지식 본문이지, 방금 한 일에 대한 리포트가
아니다. 첫 줄부터 바로 실제 지식(컨벤션/결정/용어)으로 시작해라.
한국어 마크다운 본문만 출력.

${material}`;

  let knowledge;
  try {
    knowledge = await complete(prompt);
  } catch (err) {
    return { ok: false, error: `LLM 실패: ${err.message}` };
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
