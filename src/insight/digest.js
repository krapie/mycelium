import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { complete } from '../llm.js';
import { allRaw } from '../scanner.js';
import { DIGEST_DIR, ensureDirs } from '../paths.js';
import { firstUserTurn } from '../schema.js';
import { contentLocale } from '../config.js';

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
 * and knowledge.js's foldersActiveOn() both need, exported so the two stay in
 * sync (foldersActiveOn is knowledge-review scoping, a separate concept from
 * this digest feature — see its own comment in knowledge.js). */
export function sessionsForPeriod(period, target) {
  const keyed = period === 'week' ? isoWeek(`${target}T00:00:00Z`) : target;
  return allRaw().filter((s) => {
    if (!s.startedAt) return false;
    return period === 'week' ? isoWeek(s.startedAt) === keyed : dayOf(s.startedAt) === target;
  });
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
