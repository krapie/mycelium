import { complete, parseJsonReply, mapConcurrent } from './llm.js';
import { loadRaw, saveRaw, allRaw } from './scanner.js';
import { listTags } from './index-db.js';
import { isArchive } from './organize/folders.js';
import { contentLocale } from './config.js';

// Cap how much of a long session we send to the tagger. First + last slices
// capture the intent and the outcome without paying for the whole transcript.
function sessionExcerpt(neutral, locale, budget = 6000) {
  const lines = neutral.turns.map((t) => `${t.role}: ${t.text}`);
  const joined = lines.join('\n');
  if (joined.length <= budget) return joined;
  const head = joined.slice(0, Math.floor(budget * 0.6));
  const tail = joined.slice(-Math.floor(budget * 0.4));
  const marker = locale === 'ko' ? '…(중략)…' : '…(truncated)…';
  return `${head}\n${marker}\n${tail}`;
}

// Korean prompt below is the original, unchanged — see contentLocale()
// (config.js) for why this branches instead of always using one language:
// generated content (title/tags/summary/decisions/todos) should follow
// config.json's locale the same way TUI chrome already does, not be
// hardcoded regardless of it.
function buildPrompt(neutral, existingTags, locale) {
  if (locale === 'ko') {
    const vocab = existingTags.length ? existingTags.join(', ') : '(아직 없음)';
    return `아래 세션 기록을 읽고, 이 세션의 **실질 내용(알맹이)**을 아래 JSON으로만 출력해라. 설명 금지.

핵심 규칙:
- title: 이 세션이 무엇에 관한 것인지 나타내는 구체적인 명사구(12자~30자, 마침표 없이). 활동이 아니라 대상을 적어라. 좋은 예: "KT Cloud vs AWS 선택 이유", "JWT 인증 미들웨어 리팩토링". 나쁜 예: "디버깅 세션", "코드 리뷰", "개발 작업".
- summary: 이 세션에서 **실제로 오간 내용의 알맹이**를 2~3문장으로 담아라. 무엇을 묻거나 하려 했고, 그 **핵심 답변·결론·결과·근거**가 무엇인지가 반드시 들어가야 한다.
    · 질문/논의/조사 세션: 질문의 요지 + 핵심 답과 근거를 담아라. 예: "AWS 대신 KT Cloud 등 국내 클라우드를 쓰는 이유를 논의. 데이터 주권·규제 준수(컴플라이언스)와 국내 리전 요구가 주된 이유로 정리됨."
    · 코딩/작업 세션: 무엇을 만들거나 고쳤고 그 결과가 무엇인지.
    · **금지**: "코드 변경 없음", "정보 제공만 있었음", "사용자가 묻고 어시스턴트가 답함" 같은 메타 서술. 실제 내용(답/결론/지식) 자체를 요약해라. 코드 변경 여부가 아니라 대화의 알맹이가 중요하다.
    · 내용이 얇은 세션(명령어 하나, 인사 한 줄, 아직 답이 없는 질문 하나뿐)이면 없는 내용을 지어내지 마라 — 요청받은 것 그대로를 title로 쓰고, summary는 그 요청이 무엇이었고 아직 답이나 작업이 이어지지 않았다는 한 문장으로만 써라. decisions/todos는 빈 배열.
- tags: 주제 태그 2~4개, 짧은 한국어 명사구(1~2단어). 아래 "기존 태그"에 맞는 게 있으면 표기까지 그대로 재사용해라 — 뜻이 비슷한 다른 표현을 새로 만들지 마라("인증"이 이미 있으면 "인증 처리"를 새로 만들지 말고 "인증"을 써라). 맞는 게 하나도 없을 때만 새로 만들어라. 도구 이름("claude", "cursor")이나 일반 활동어("디버깅", "리팩토링", "논의")는 태그로 쓰지 마라.
- decisions: 실제로 확정된 것만 — 논의만 되고 결론나지 않은 선택지는 제외. 각 항목은 결정 내용 자체를 짧은 한 문장으로 써라("운영 리전은 KT Cloud로 간다"), "사용자가 ~하기로 했다" 같은 서술체 말고. 없으면 [].
- todos: 명시적으로 남겨진 할 일만, 각 항목은 짧은 명령형 한 문장으로("웹훅 핸들러에 재시도 추가"). 없으면 []. 언급되지 않은 후속 작업을 지어내지 마라.

기존 태그: ${vocab}

세션 기록:
"""
${sessionExcerpt(neutral, locale)}
"""

출력 형식:
{"title": "", "tags": [], "summary": "", "decisions": [], "todos": []}
출력은 JSON 객체 하나뿐. 앞뒤에 다른 텍스트를 붙이지 마라. 모든 필드를 반드시 포함하고, 값이 없으면 필드를 빼지 말고 ""나 []로 채워라.`;
  }

  const vocab = existingTags.length ? existingTags.join(', ') : '(none yet)';
  return `Read the session record below and output ONLY the following JSON describing the **actual substance** of this session. No explanation.

Key rules:
- title: one line, a specific noun phrase naming what this session is actually about — 3-8 words, no trailing period. Name the concrete subject, not the activity. Good: "Why KT Cloud over AWS", "JWT auth middleware refactor". Bad: "Debugging session", "Code review", "Development work".
- summary: capture the **actual substance of what was discussed** in 2-3 sentences. Must include what was asked or attempted AND the **key answer, conclusion, result, or reasoning**.
    · Q&A/discussion/research sessions: the gist of the question + the key answer and its reasoning. e.g. "Discussed using a domestic cloud provider instead of AWS. Data sovereignty and regional compliance requirements were the main reasons."
    · Coding/work sessions: what was built or fixed and what the result was.
    · **Forbidden**: meta-descriptions like "no code changes", "just provided information", "user asked and assistant answered". Summarize the actual content (the answer/conclusion/knowledge) itself — what matters is the substance of the conversation, not whether code changed.
    · Thin sessions (a single command, a bare greeting, one unanswered question) — if there's no real exchange yet, don't invent substance. Title it after the literal thing that was asked, make summary one sentence naming that request and stating that no answer or work followed, and leave decisions/todos empty.
- tags: 2-4 topic tags. Lowercase, 1-2 words, hyphen for multi-word ("auth", "ci-cd"). Reuse an entry from "Existing tags" below exactly as written whenever one fits — including when yours is only a near-synonym of it (use "auth" if that exists, never "authentication"). Invent a tag only when nothing in that list fits. Never tag with a tool name ("claude", "cursor") or a generic activity ("debugging", "refactoring", "discussion").
- decisions: settled conclusions only — something actually chosen, not an option merely discussed. One short sentence each, phrased as the decision itself ("Use KT Cloud for the production region"), not as narration ("The user decided to..."). Empty array if nothing was settled.
- todos: work explicitly left for later, one short imperative each ("Add a retry to the webhook handler"). Empty array if none. Never invent a follow-up that was not mentioned.

Existing tags: ${vocab}

Session record:
"""
${sessionExcerpt(neutral, locale)}
"""

Output format:
{"title": "", "tags": [], "summary": "", "decisions": [], "todos": []}
Output exactly one JSON object, with nothing before or after it. Every field must be present — use "" or [] rather than omitting one.`;
}

/**
 * Content-based auto-tagging via a headless LLM call — the differentiator no
 * surveyed tool does (they pattern-match on dir/name only). Existing tag
 * vocabulary is fed in to keep the vocabulary from diverging.
 *
 * The title is sticky only once a human has explicitly set it (`e`,
 * setContent() → titleLocked). An LLM-generated title is deliberately NOT
 * sticky — a session captured early (e.g. right after a bare `/clear` or a
 * `!`-command with no real conversation yet) gets a near-useless title from
 * that thin content, and without this it would stay wrong forever even once
 * the same session grows into a real conversation. tags/summary/decisions/
 * todos always refresh to the latest LLM read regardless.
 *
 * `summarizedTurnCount` records how many turns existed at this run — see
 * tagAll()'s doc comment for what that's for.
 */
export async function autoTagSession(sessionId, { existingTags } = {}) {
  const n = loadRaw(sessionId);
  if (!n) return { ok: false, error: `no session ${sessionId}` };
  if (n.turns.length === 0) return { ok: false, error: 'empty session' };

  const vocab = existingTags || listTags().map((t) => t.name);
  let reply;
  try {
    reply = await complete(buildPrompt(n, vocab, contentLocale()));
  } catch (err) {
    // complete() rejects on spawn failure, non-zero exit, or timeout — this
    // was previously unguarded, so any of those became an unhandled promise
    // rejection instead of a reported failure (no message, just "it failed").
    return { ok: false, error: `LLM failed: ${err.message}` };
  }
  const parsed = parseJsonReply(reply);
  if (!parsed) return { ok: false, error: 'unparseable LLM reply' };

  if (!n.titleLocked && typeof parsed.title === 'string') {
    n.extracted.title = parsed.title.trim();
  }
  if (Array.isArray(parsed.tags)) {
    n.extracted.tags = parsed.tags.filter((t) => typeof t === 'string' && t.trim()).slice(0, 5);
  }
  if (typeof parsed.summary === 'string') n.extracted.summary = parsed.summary;
  if (Array.isArray(parsed.decisions)) n.extracted.decisions = parsed.decisions;
  if (Array.isArray(parsed.todos)) n.extracted.todos = parsed.todos;
  n.summarizedTurnCount = n.turns.length;
  saveRaw(n);
  return { ok: true, session: n };
}

/**
 * Retroactive batch tagging. `force` re-tags everything; otherwise skips a
 * session only if it already has a summary AND hasn't grown since
 * (`summarizedTurnCount === turns.length`) — a session with no baseline yet
 * (`summarizedTurnCount: null`, i.e. everything that predates this field)
 * still gets skipped-if-summarized, same as before, so shipping this doesn't
 * suddenly re-tag the entire existing store in one cycle. Once a session
 * does get (re)tagged, its baseline is recorded and growth-detection kicks
 * in for it from then on. Tags accumulate into the shared vocabulary as we
 * go, so later sessions reuse earlier sessions' tags instead of inventing
 * parallel ones.
 *
 * `limit` bounds how many actually get processed in this call (oldest
 * first, same ordering suggestPlacements() uses) — without it, a big
 * backlog (e.g. the very first scan importing hundreds of historical
 * sessions) makes one call run long enough that the daemon's 5-minute scan
 * timer fires again before it finishes, piling up overlapping LLM calls
 * (see issue #3). The rest just wait for the next call instead of all
 * being attempted at once.
 *
 * `concurrency` (default 1, i.e. sequential — unchanged for any existing
 * caller that doesn't pass it) runs up to that many autoTagSession() calls
 * at once via mapConcurrent() (llm.js), the same bounded-concurrency
 * pattern organize.js's summarizeCandidates()/suggestPlacements() already
 * use. Vocab accumulation stays correct across concurrent lanes for the
 * same reason it does there: each lane fully awaits its own
 * autoTagSession() before touching the shared Set, so a race only ever
 * means "this lane didn't see a tag another lane just added," a quality
 * nicety, not a correctness requirement.
 *
 * `stopAfterConsecutiveFailures` (mapConcurrent(), default 3) — same
 * circuit breaker organize.js's summarizeCandidates()/suggestPlacements()
 * use: once real LLM usage runs out, every subsequent call fails
 * identically, so this stops scheduling new work once that's clear rather
 * than one-at-a-time failing through the rest of `targets`. Each success
 * is still written to its own raw/<id>.json before this can trip, so
 * stopping early never loses prior progress.
 */
export async function tagAll({ force = false, onProgress, limit, concurrency = 1, stopAfterConsecutiveFailures = 3 } = {}) {
  const vocab = new Set(listTags().map((t) => t.name));
  let tagged = 0;
  let skipped = 0;
  let failed = 0;

  let targets = allRaw().filter((n) => {
    // Skip _archive — capture's auto-archived old backlog (thousands of
    // historical sessions on a first scan) shouldn't get swept into automatic
    // summarization by the daemon's tagAll() cycle. Per-session summarize
    // (detail `a` → autoTagSession() directly) still works if a user opens one.
    if (isArchive(n.folder)) {
      skipped++;
      return false;
    }
    const upToDate = n.extracted.summary && (!n.summarizedTurnCount || n.summarizedTurnCount === n.turns.length);
    if (force || !upToDate) return true;
    skipped++;
    return false;
  });
  targets.sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''));
  if (limit) targets = targets.slice(0, limit);

  const { stoppedEarly } = await mapConcurrent(
    targets,
    concurrency,
    async (n) => {
      try {
        const res = await autoTagSession(n.id, { existingTags: [...vocab] });
        if (res.ok) {
          tagged++;
          for (const t of res.session.extracted.tags) vocab.add(t);
          if (onProgress) onProgress(res.session);
          return { ok: true };
        }
        failed++;
        return { ok: false };
      } catch (err) {
        failed++;
        if (onProgress) onProgress(null, err);
        return { ok: false };
      }
    },
    { stopAfterConsecutiveFailures },
  );
  return { tagged, skipped, failed, stoppedEarly };
}
