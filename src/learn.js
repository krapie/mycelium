import { complete, parseJsonReply } from './llm.js';
import { loadRaw, saveRaw, allRaw } from './scanner.js';
import { listTags } from './index-db.js';

// Cap how much of a long session we send to the tagger. First + last slices
// capture the intent and the outcome without paying for the whole transcript.
function sessionExcerpt(neutral, budget = 6000) {
  const lines = neutral.turns.map((t) => `${t.role}: ${t.text}`);
  const joined = lines.join('\n');
  if (joined.length <= budget) return joined;
  const head = joined.slice(0, Math.floor(budget * 0.6));
  const tail = joined.slice(-Math.floor(budget * 0.4));
  return `${head}\n…(중략)…\n${tail}`;
}

function buildPrompt(neutral, existingTags) {
  const vocab = existingTags.length ? existingTags.join(', ') : '(아직 없음)';
  return `아래 세션 기록을 읽고, **실제로 수행된 작업(task)** 관점에서 아래 JSON만 출력해라. 설명 금지.

핵심 규칙:
- summary는 "대화가 어떻게 흘러갔는지"가 아니라 **"무슨 작업을 했고 무엇이 만들어지거나 바뀌었는지"**를 결과물 중심으로 1~2문장. 예: "인증 미들웨어의 JWT 검증 로직을 별도 함수로 분리하고 테스트를 추가함." 나쁜 예: "사용자가 요청했고 어시스턴트가 분석한 뒤 답변함."
- "이 세션은/어시스턴트가/사용자가 ~했다" 같은 대화 서술 금지. 산출물과 행위(만듦/수정함/고침/추가함/결정함) 중심으로.
- tags: 작업의 주제를 나타내는 2~4개 태그. 아래 "기존 태그"에 맞는 게 있으면 반드시 재사용, 없을 때만 새로. 짧은 한국어 명사구.
- decisions: 내려진 기술/업무 결정 (없으면 []).
- todos: 남은 할 일 (없으면 []).

기존 태그: ${vocab}

세션 기록:
"""
${sessionExcerpt(neutral)}
"""

출력 형식:
{"tags": [], "summary": "", "decisions": [], "todos": []}`;
}

/**
 * Content-based auto-tagging via a headless LLM call — the differentiator no
 * surveyed tool does (they pattern-match on dir/name only). Existing tag
 * vocabulary is fed in to keep the vocabulary from diverging.
 *
 * Sticky rule: for a human-organized session we DO refresh summary/decisions/
 * todos (those are insights, not filing), but never overwrite the human's tags.
 */
export async function autoTagSession(sessionId, { existingTags } = {}) {
  const n = loadRaw(sessionId);
  if (!n) return { ok: false, error: `no session ${sessionId}` };
  if (n.turns.length === 0) return { ok: false, error: 'empty session' };

  const vocab = existingTags || listTags().map((t) => t.name);
  const reply = await complete(buildPrompt(n, vocab));
  const parsed = parseJsonReply(reply);
  if (!parsed) return { ok: false, error: 'unparseable LLM reply' };

  if (n.organizedBy !== 'human' && Array.isArray(parsed.tags)) {
    n.extracted.tags = parsed.tags.filter((t) => typeof t === 'string' && t.trim()).slice(0, 5);
  }
  if (typeof parsed.summary === 'string') n.extracted.summary = parsed.summary;
  if (Array.isArray(parsed.decisions)) n.extracted.decisions = parsed.decisions;
  if (Array.isArray(parsed.todos)) n.extracted.todos = parsed.todos;
  saveRaw(n);
  return { ok: true, session: n };
}

/**
 * Retroactive batch tagging. `force` re-tags everything; otherwise only
 * sessions with no summary yet (so a re-run is cheap and resumable). Tags
 * accumulate into the shared vocabulary as we go, so later sessions reuse
 * earlier sessions' tags instead of inventing parallel ones.
 */
export async function tagAll({ force = false, onProgress } = {}) {
  const vocab = new Set(listTags().map((t) => t.name));
  let tagged = 0;
  let skipped = 0;
  let failed = 0;

  for (const n of allRaw()) {
    if (!force && n.extracted.summary) {
      skipped++;
      continue;
    }
    try {
      const res = await autoTagSession(n.id, { existingTags: [...vocab] });
      if (res.ok) {
        tagged++;
        for (const t of res.session.extracted.tags) vocab.add(t);
        if (onProgress) onProgress(res.session);
      } else {
        failed++;
      }
    } catch (err) {
      failed++;
      if (onProgress) onProgress(null, err);
    }
  }
  return { tagged, skipped, failed };
}
