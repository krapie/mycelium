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
  return `다음은 AI 코딩/업무 세션의 대화 기록이다. 내용을 읽고 아래 JSON만 출력해라. 설명 금지.

규칙:
- tags: 이 세션의 주제를 나타내는 2~4개 태그. 아래 "기존 태그"에 맞는 게 있으면 반드시 재사용하고, 없을 때만 새로 만든다. 태그는 짧은 한국어 명사구.
- summary: 이 세션에서 무슨 일이 있었는지 2~3문장 요약.
- decisions: 내려진 주요 결정 (없으면 []).
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
