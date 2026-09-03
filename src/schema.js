/**
 * Neutral session schema — the model-agnostic form every adapter produces.
 *
 * Design references (verified this session):
 * - authsec-bridge's NeutralSession: an ordered list of user/assistant turns
 *   plus *prose summaries* of tool calls. Full tool-call replay across vendors
 *   is unsolved and unnecessary — the artifacts already live on disk.
 * - `extracted.*` is left empty by capture and filled later by the Learn step,
 *   so capture never depends on an LLM being available.
 *
 * {
 *   id, source, cwd, startedAt, endedAt,
 *   turns:        [ { role: "user"|"assistant", text } ],
 *   toolActivity: [ "Edit src/auth.ts", "Ran tests (3 passed)" ],
 *   artifacts:    { filesChanged: [], diffSummary: null },
 *   extracted:    { title: null, tags: [], summary: null, decisions: [], todos: [] },
 *   kind:         "session" | "backlog"  // backlog = user-written intent note, no transcript
 *   organizedBy:  "auto" | "human",   // sticky flag — see organize step
 *   folder:       "회사/플랫폼/인증"    // tree path (null = _inbox)
 *   suggestedFolder, suggestedReason  // queued smart-organize guess, cleared on review
 *   lastClassifiedAt  // ISO timestamp, last time suggestPlacements() evaluated this session (any outcome)
 *   titleLocked       // true once a human sets the title (setContent) — autoTagSession() then never overwrites it
 *   summarizedTurnCount  // turns.length as of the last autoTagSession() run — lets tagAll() re-summarize a session that grew instead of skipping it forever
 *   mergedFrom, splitFrom, supersededBy, splitInto  // split/merge lineage — see organize.js/split.js
 * }
 */

/** A backlog item — a user-written intent note, not a captured agent session.
 * Lives here rather than in backlog.js so the guards that need it (learn.js,
 * insight/*, organize/*, split.js) can import it from the leaf module every
 * one of them already depends on, with no import cycle back through
 * backlog.js → scanner.js/organize.js. */
export function isBacklog(n) {
  return !!n && n.kind === 'backlog';
}

export function emptyNeutral(id, source) {
  return {
    id,
    source,
    cwd: null, // message-level working dir (used for organize / folder auto-placement)
    projectDir: null, // dir the agent resolves --resume against (Claude: the project folder)
    startedAt: null,
    endedAt: null,
    turns: [],
    toolActivity: [],
    artifacts: { filesChanged: [], diffSummary: null },
    extracted: { title: null, tags: [], summary: null, decisions: [], todos: [] },
    organizedBy: 'auto',
    folder: null,
    kind: 'session', // 'backlog' = a user-written intent note, not a captured agent session (backlog.js)
    doneAt: null, // backlog only: when it was opened into a real agent session
    continuationOf: null, // this session continues another (handoff parent id)
    continuedTo: [], // sessions that continued this one (handoff children)
    suggestedFolder: null, // smart-organize's queued-but-unreviewed placement guess
    suggestedReason: null, // short LLM-given reason for suggestedFolder
    lastClassifiedAt: null, // suggestPlacements()'s last look at this session — avoids re-asking the LLM every cycle when nothing matched
    titleLocked: false, // true once a human sets the title — protects it from autoTagSession() overwrites
    summarizedTurnCount: null, // turns.length as of the last autoTagSession() run — null means "never tracked", see tagAll()
    mergedFrom: [], // ids folded into this session (non-empty only on a merge product)
    splitFrom: null, // id this session was sliced out of (non-null only on a split product)
    supersededBy: [], // merge product that replaced this session — hidden by default, like _archive
    splitInto: [], // pieces sliced out of this session — informational only, this session STAYS visible
  };
}

// Claude Code injects several synthetic "user"-role turns nobody typed
// (slash-command echoes, bash tool output, <system-reminder>, etc.) — all
// start with an XML-ish tag, which a real person's first message essentially
// never does, so skip past them when picking a turn for the preview.
const SYNTHETIC_TURN = /^<[a-z][a-z-]*>/i;

/**
 * The first real (non-synthetic) user turn, or null if there isn't one.
 * Split out from firstUserText() below so callers that need more than a
 * short list-preview (handoff.js's ~800-char excerpt, insight.js's ~80-char
 * digest line) can apply their own truncation on top of the same
 * synthetic-turn-skipping search, instead of being stuck with this file's
 * 200-char preview length.
 */
export function firstUserTurn(neutral) {
  return neutral.turns.find((x) => x.role === 'user' && x.text?.trim() && !SYNTHETIC_TURN.test(x.text.trim())) || null;
}

/** A short one-line preview used in lists / FTS fallback. */
export function firstUserText(neutral) {
  const t = firstUserTurn(neutral);
  return t ? t.text.trim().slice(0, 200) : '';
}

/** Full searchable text blob for FTS indexing. */
export function searchableText(neutral) {
  const parts = [];
  // Title first: for a backlog item (isBacklog) it's the ONLY text there is
  // besides the description, and for a captured session it's the phrase
  // someone is most likely to search by.
  if (neutral.extracted.title) parts.push(neutral.extracted.title);
  for (const turn of neutral.turns) if (turn.text) parts.push(turn.text);
  for (const a of neutral.toolActivity) parts.push(a);
  if (neutral.extracted.summary) parts.push(neutral.extracted.summary);
  return parts.join('\n');
}
