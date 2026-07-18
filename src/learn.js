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
  return `아래 세션 기록을 읽고, 이 세션의 **실질 내용(알맹이)**을 아래 JSON으로만 출력해라. 설명 금지.

핵심 규칙:
- title: 이 세션이 무엇에 관한 것인지 한 줄로 나타내는 짧은 제목(명사구, 12자~30자). 예: "KT Cloud vs AWS 선택 이유", "JWT 인증 미들웨어 리팩토링".
- summary: 이 세션에서 **실제로 오간 내용의 알맹이**를 2~3문장으로 담아라. 무엇을 묻거나 하려 했고, 그 **핵심 답변·결론·결과·근거**가 무엇인지가 반드시 들어가야 한다.
    · 질문/논의/조사 세션: 질문의 요지 + 핵심 답과 근거를 담아라. 예: "AWS 대신 KT Cloud 등 국내 클라우드를 쓰는 이유를 논의. 데이터 주권·규제 준수(컴플라이언스)와 국내 리전 요구가 주된 이유로 정리됨."
    · 코딩/작업 세션: 무엇을 만들거나 고쳤고 그 결과가 무엇인지.
    · **금지**: "코드 변경 없음", "정보 제공만 있었음", "사용자가 묻고 어시스턴트가 답함" 같은 메타 서술. 실제 내용(답/결론/지식) 자체를 요약해라. 코드 변경 여부가 아니라 대화의 알맹이가 중요하다.
- tags: 주제 태그 2~4개. 아래 "기존 태그"에 맞는 게 있으면 반드시 재사용, 없을 때만 새로. 짧은 한국어 명사구.
- decisions: 내려진 결정/결론 (없으면 []).
- todos: 남은 할 일 (없으면 []).

기존 태그: ${vocab}

세션 기록:
"""
${sessionExcerpt(neutral)}
"""

출력 형식:
{"title": "", "tags": [], "summary": "", "decisions": [], "todos": []}`;
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
  if (typeof parsed.title === 'string') n.extracted.title = parsed.title.trim();
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
