import { randomUUID } from 'node:crypto';
import { complete, parseJsonReply } from './llm.js';
import { loadRaw, saveRaw, deleteRaw } from './scanner.js';
import { emptyNeutral } from './schema.js';
import { contentLocale } from './config.js';

// Cap per-turn text sent to the LLM (not a head/tail slice like learn.js's
// sessionExcerpt — split needs every turn's INDEX to stay visible so the
// returned ranges are trustworthy, so every turn is included, just each one
// individually truncated).
const MAX_TURN_CHARS = 300;

function numberedTurns(turns, locale) {
  const label = locale === 'ko' ? '턴' : 'Turn';
  return turns
    .map((t, i) => `${label} ${i + 1} [${t.role}]: ${(t.text || '').replace(/\s+/g, ' ').slice(0, MAX_TURN_CHARS)}`)
    .join('\n');
}

/**
 * Ask the LLM to propose topic boundaries for one session, as 1-indexed
 * inclusive turn ranges. Writes nothing — the TUI reviews the proposal
 * (multiSelectList, same "LLM proposes, human confirms" shape as
 * organize.js's suggestPlacements()) before applySplit() commits any of it.
 */
export async function suggestSplitBoundaries(sessionId) {
  const locale = contentLocale();
  const n = loadRaw(sessionId);
  if (!n) return { ok: false, error: `no session ${sessionId}` };
  if (n.turns.length < 4) {
    return { ok: false, error: locale === 'ko' ? '분할하기엔 세션이 너무 짧습니다' : 'Session is too short to split' };
  }

  // Two natively-worded branches, not a translation of one into the
  // other — see contentLocale() (config.js).
  const prompt =
    locale === 'ko'
      ? `아래는 하나의 AI 작업 세션의 전체 대화 기록이다. 턴 번호가 매겨져 있다(1부터 시작, user/assistant 메시지 하나가 턴 하나).

이 세션이 다루는 주제들을 파악해서, 각 주제가 시작~끝나는 턴 범위로 나눠라. 모든 턴을 빠짐없이, 겹치지 않게 순서대로 커버해야 한다.

- 주제가 실제로 바뀌는 지점에서만 잘라라. 후속 질문, 부연 설명, 같은 작업의 재시도, 다시 원래 주제로 돌아오는 곁가지는 경계가 아니다. 대부분의 세션은 주제가 하나나 둘이고, 넷을 넘으면 거의 항상 과하게 쪼갠 것이다.
- 2턴보다 짧은 구간은 만들지 마라.
- 세션 전체가 한 주제면 1번 턴부터 마지막 턴까지를 덮는 구간 하나만 반환해라. 그건 정상적이고 기대되는 답이지, 못 찾은 게 아니다.
- label: 그 구간이 무엇에 관한 것인지 나타내는 구체적인 명사구(12자~30자, 마침표 없이).

${numberedTurns(n.turns, locale)}

출력 형식(JSON만, 다른 설명 없이):
{"ranges":[{"from":1,"to":8,"label":"짧은 주제 설명"}]}`
      : `Below is the full transcript of one AI work session. Turns are numbered (starting at 1, one turn per user/assistant message).

Identify the topics this session covers and split it into turn ranges where each topic starts and ends. Every turn must be covered, in order, with no gaps or overlaps.

- Split only where the subject genuinely changes. A follow-up question, a clarification, a retry of the same thing, or a tangent that returns to the same subject is NOT a boundary. Most sessions have one or two topics; more than four is almost always over-splitting.
- No range shorter than 2 turns.
- If the whole session is one topic, return exactly one range covering turn 1 through the last turn. That is a normal, expected answer — not a failure to find something.
- label: a specific noun phrase naming that range's subject, 3-8 words, no trailing period.

${numberedTurns(n.turns, locale)}

Output format (JSON only, no other explanation):
{"ranges":[{"from":1,"to":8,"label":"short topic label"}]}`;

  let reply;
  try {
    reply = await complete(prompt);
  } catch (err) {
    return { ok: false, error: `LLM failed: ${err.message}` };
  }
  const parsed = parseJsonReply(reply);
  const fallbackLabel = locale === 'ko' ? '턴' : 'Turn';
  const ranges = (parsed?.ranges || [])
    .filter((r) => Number.isInteger(r.from) && Number.isInteger(r.to) && r.from >= 1 && r.to >= r.from && r.to <= n.turns.length)
    .map((r) => ({ from: r.from, to: r.to, label: (r.label || '').trim() || `${fallbackLabel} ${r.from}-${r.to}` }));
  if (!ranges.length) {
    return { ok: false, error: locale === 'ko' ? '분할 지점을 찾지 못했습니다' : 'No split boundaries found' };
  }
  return { ok: true, ranges, session: n };
}

/**
 * Commit a (human-reviewed) subset of ranges: one new session per range,
 * turns sliced from the original (never mutating it — see organize.js's
 * mergeSessions() doc for why). cwd/projectDir are inherited from the
 * original, unlike a merge product — a split piece is still a real slice of
 * one real conversation in one real working directory, which is what makes
 * `n` (new session with this folder's context) and handoff meaningful
 * afterward.
 *
 * Unlike merge, the original stays fully visible afterward (`splitInto` is
 * informational only, not the supersededBy hide flag) — none of its content
 * has actually moved anywhere else the way a merge's does, and pieces only
 * ever cover checked ranges, so hiding it could bury content that isn't in
 * any piece at all.
 */
export function applySplit(sessionId, ranges) {
  const locale = contentLocale();
  const original = loadRaw(sessionId);
  if (!original) return { ok: false, error: `no session ${sessionId}` };
  if (!ranges?.length) return { ok: false, error: locale === 'ko' ? '분할할 구간이 없습니다' : 'No ranges to split' };

  const pieces = [];
  for (const r of ranges) {
    const slice = original.turns.slice(Math.max(0, r.from - 1), r.to);
    if (!slice.length) continue;
    const piece = emptyNeutral(randomUUID(), original.source);
    piece.cwd = original.cwd;
    piece.projectDir = original.projectDir;
    piece.startedAt = original.startedAt;
    piece.endedAt = original.endedAt;
    piece.turns = slice;
    piece.splitFrom = sessionId;
    piece.extracted.title = r.label || null;
    // Locked for the same reason mergeSessions() now locks an explicit
    // merge title — this came from an LLM boundary suggestion the human
    // already reviewed and accepted (or the "턴 N-M" fallback, still a real
    // anchor), so the auto-summarize pass sessions.js runs right after a
    // split (autoTagSession(), same call `a` uses) must not silently
    // replace it with something else; titleLocked is what already protects
    // a deliberately-set title from that.
    piece.titleLocked = !!piece.extracted.title;
    piece.artifacts.filesChanged = original.artifacts.filesChanged || [];
    // Same folder as the original, not left unfiled — a split is a
    // deliberate reorganization of one already-placed session, so its
    // pieces should land where the original was, same as move()'s explicit
    // placement (and marked 'human' for the same reason: don't let a later
    // cwd-rule auto-organize pass reshuffle it elsewhere).
    piece.folder = original.folder;
    piece.organizedBy = 'human';
    // Propagate demo:true (see organize/lineage.js's mergeSessions() for
    // why) so a split inside the tutorial/mycelium demo doesn't leave an
    // orphaned piece behind after endTutorial()'s demo:true sweep.
    if (original.demo) piece.demo = true;
    saveRaw(piece);
    pieces.push(piece);
  }
  if (!pieces.length) return { ok: false, error: locale === 'ko' ? '유효한 구간이 없습니다' : 'No valid ranges' };

  original.splitInto = pieces.map((p) => p.id);
  saveRaw(original);
  return { ok: true, pieces, original };
}

/** Reverse of applySplit(): delete the pieces, clear the original's split marker. */
export function unsplit(originalId) {
  const locale = contentLocale();
  const original = loadRaw(originalId);
  if (!original) return { ok: false, error: `no session ${originalId}` };
  if (!original.splitInto?.length) {
    return { ok: false, error: locale === 'ko' ? '분할된 세션이 아닙니다' : 'Not a split session' };
  }

  const removed = [];
  for (const id of original.splitInto) {
    const piece = loadRaw(id);
    if (piece?.splitFrom === originalId) {
      deleteRaw(id);
      removed.push(id);
    }
  }
  original.splitInto = [];
  saveRaw(original);
  return { ok: true, removed };
}
