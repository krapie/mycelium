import { randomUUID } from 'node:crypto';
import { complete, parseJsonReply } from './llm.js';
import { loadRaw, saveRaw, deleteRaw } from './scanner.js';
import { emptyNeutral } from './schema.js';

// Cap per-turn text sent to the LLM (not a head/tail slice like learn.js's
// sessionExcerpt — split needs every turn's INDEX to stay visible so the
// returned ranges are trustworthy, so every turn is included, just each one
// individually truncated).
const MAX_TURN_CHARS = 300;

function numberedTurns(turns) {
  return turns
    .map((t, i) => `턴 ${i + 1} [${t.role}]: ${(t.text || '').replace(/\s+/g, ' ').slice(0, MAX_TURN_CHARS)}`)
    .join('\n');
}

/**
 * Ask the LLM to propose topic boundaries for one session, as 1-indexed
 * inclusive turn ranges. Writes nothing — the TUI reviews the proposal
 * (multiSelectList, same "LLM proposes, human confirms" shape as
 * organize.js's suggestPlacements()) before applySplit() commits any of it.
 */
export async function suggestSplitBoundaries(sessionId) {
  const n = loadRaw(sessionId);
  if (!n) return { ok: false, error: `no session ${sessionId}` };
  if (n.turns.length < 4) return { ok: false, error: '분할하기엔 세션이 너무 짧습니다' };

  const prompt = `아래는 하나의 AI 작업 세션의 전체 대화 기록이다. 턴 번호가 매겨져 있다(1부터 시작, user/assistant 메시지 하나가 턴 하나).

이 세션이 다루는 주제들을 파악해서, 각 주제가 시작~끝나는 턴 범위로 나눠라(주제가 하나뿐이면 구간도 하나만). 모든 턴을 빠짐없이, 겹치지 않게 순서대로 커버해야 한다. label은 12~30자 명사구로 그 구간이 무엇에 관한 것인지 나타내라.

${numberedTurns(n.turns)}

출력 형식(JSON만, 다른 설명 없이):
{"ranges":[{"from":1,"to":8,"label":"짧은 주제 설명"}]}`;

  let reply;
  try {
    reply = await complete(prompt);
  } catch (err) {
    return { ok: false, error: `LLM failed: ${err.message}` };
  }
  const parsed = parseJsonReply(reply);
  const ranges = (parsed?.ranges || [])
    .filter((r) => Number.isInteger(r.from) && Number.isInteger(r.to) && r.from >= 1 && r.to >= r.from && r.to <= n.turns.length)
    .map((r) => ({ from: r.from, to: r.to, label: (r.label || '').trim() || `턴 ${r.from}-${r.to}` }));
  if (!ranges.length) return { ok: false, error: '분할 지점을 찾지 못했습니다' };
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
  const original = loadRaw(sessionId);
  if (!original) return { ok: false, error: `no session ${sessionId}` };
  if (!ranges?.length) return { ok: false, error: '분할할 구간이 없습니다' };

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
  if (!pieces.length) return { ok: false, error: '유효한 구간이 없습니다' };

  original.splitInto = pieces.map((p) => p.id);
  saveRaw(original);
  return { ok: true, pieces, original };
}

/** Reverse of applySplit(): delete the pieces, clear the original's split marker. */
export function unsplit(originalId) {
  const original = loadRaw(originalId);
  if (!original) return { ok: false, error: `no session ${originalId}` };
  if (!original.splitInto?.length) return { ok: false, error: '분할된 세션이 아닙니다' };

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
