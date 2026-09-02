import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { complete } from '../llm.js';
import { allRaw } from '../scanner.js';
import { DIGEST_DIR, ensureDirs } from '../paths.js';
import { firstUserTurn } from '../schema.js';
import { contentLocale } from '../config.js';

// Caps how many sessions one folder can contribute to a digest prompt —
// unbounded before this, so a busy folder over a `period: 'week'` digest
// had no ceiling at all. Most-recent first within the folder.
const DIGEST_FOLDER_ITEM_CAP = 20;

// Caps the TOTAL prompt material across every folder combined — the
// per-folder cap above still leaves a day/week with many active folders
// unbounded, since each one's (capped) block still adds up.
const DIGEST_TOTAL_CHAR_CAP = 12000;

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

  // Real folder headings, not a flattened "[folder]" prefix on every
  // line — the prompt below asks for material "grouped by folder," but
  // until this the model only ever received an undifferentiated list
  // with bracketed text, no actual grouping. Also caps how many sessions
  // one folder can contribute (most-recent first) — unbounded before
  // this, so a busy folder over a `period: 'week'` digest had no ceiling.
  // Per-folder capping alone still leaves the TOTAL unbounded when many
  // folders are active on the same period (found via CodeRabbit review
  // on this PR) — DIGEST_TOTAL_CHAR_CAP bounds the sum across every
  // folder block too, stopping once it's hit rather than after the fact.
  const byFolder = groupByFolder(sessions);
  const blocks = [];
  let totalUsed = 0;
  let foldersOmitted = 0;
  for (const [folder, ss] of byFolder) {
    const ordered = [...ss].sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
    const shown = ordered.slice(0, DIGEST_FOLDER_ITEM_CAP);
    const omitted = ordered.length - shown.length;
    const items = shown.map((s) => `- ${s.extracted.summary || firstUserTurn(s)?.text?.slice(0, 80) || noSummary}`).join('\n');
    const omittedLine = omitted
      ? `\n${locale === 'ko' ? `…(${omitted}개 세션 생략)…` : `…(${omitted} more session${omitted === 1 ? '' : 's'} omitted)…`}`
      : '';
    let block = `## ${folder}\n${items}${omittedLine}`;
    if (totalUsed + block.length > DIGEST_TOTAL_CHAR_CAP) {
      // The `blocks.length` guard used to skip this check entirely for
      // the first folder, so a single folder whose own block alone
      // exceeded the cap still got included in full (found via
      // CodeRabbit review — the same class of bug just fixed in
      // knowledge.js's material budget, now caught here too). Truncate
      // that one block instead of either including it whole or skipping
      // it outright and ending up with zero folders shown when there IS
      // real content.
      if (blocks.length === 0) {
        block = block.slice(0, DIGEST_TOTAL_CHAR_CAP);
        blocks.push(block);
        totalUsed += block.length + 2;
      } else {
        foldersOmitted++;
      }
      continue;
    }
    blocks.push(block);
    totalUsed += block.length + 2;
  }
  if (foldersOmitted) {
    blocks.push(
      locale === 'ko'
        ? `…(폴더 ${foldersOmitted}개 더 있음, 표시 생략)…`
        : `…(${foldersOmitted} more folder${foldersOmitted === 1 ? '' : 's'} not shown)…`,
    );
  }

  // Two natively-worded branches, not a translation of one into the
  // other — see contentLocale() (config.js).
  const prompt =
    locale === 'ko'
      ? `아래는 ${keyed} 기간 동안의 AI 작업 세션 요약이다(폴더별). 사람이 아침에 읽는 인수인계 메모처럼 서사형으로 정리해라.

- 3~6문장, 한 문단. 상태 카운트도, 불릿 목록도 아니다.
- 항목들을 가로질러 종합해라: 이 기간이 결국 무엇에 관한 것이었고, 무엇이 확정됐고, 무엇이 남았는지. 항목을 하나씩 다시 읊지 마라 — 두 폴더가 같은 작업의 일부였다면 그걸 한 문장으로 말해라.
- 이 작업을 직접 한 사람이 다음 날 아침에 읽는다고 생각하고 써라. 예: "하루 대부분이 재주문 플로우에 들어갔다 — 중복 제출 버그는 결국 멱등성 키 누락이었고 이건 정리됐다. 장바구니 반올림 수정은 작성은 했지만 아직 검증 전이다."
- 금지: "다이제스트입니다", "요약하면", "이 리포트는" 같은 메타 문구로 시작하거나 끝내지 마라. 바로 내용부터 시작해라.

${blocks.join('\n\n')}

출력은 마크다운 본문만.`
      : `Below are the AI work sessions from ${keyed}, grouped by folder. Write this up as a narrative, the way a colleague's morning handoff note reads.

- 3-6 sentences, one paragraph. Not a status count, not a bulleted list.
- Synthesize across the entries: what the period was actually about, what got settled, what is still open. Do not walk the list restating entries one at a time — if two folders were part of the same push, say that in one sentence.
- Write it for the person who did this work, reading it the next morning. e.g. "Most of the day went into the reorder flow — the duplicate-submit bug turned out to be a missing idempotency key and that's settled now; the cart rounding fix is written but still unverified."
- Forbidden: opening or closing with a meta phrase like "Here is the digest", "In summary", "This report covers". Start with the substance.

${blocks.join('\n\n')}

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
