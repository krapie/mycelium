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
 *   extracted:    { tags: [], summary: null, decisions: [], todos: [] },
 *   organizedBy:  "auto" | "human",   // sticky flag — see organize step
 *   folder:       "회사/플랫폼/인증"    // tree path (null = _inbox)
 * }
 */

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
    continuationOf: null, // this session continues another (handoff parent id)
    continuedTo: [], // sessions that continued this one (handoff children)
  };
}

/** A short one-line preview used in lists / FTS fallback. */
export function firstUserText(neutral) {
  const t = neutral.turns.find((x) => x.role === 'user' && x.text?.trim());
  return t ? t.text.trim().slice(0, 200) : '';
}

/** Full searchable text blob for FTS indexing. */
export function searchableText(neutral) {
  const parts = [];
  for (const turn of neutral.turns) if (turn.text) parts.push(turn.text);
  for (const a of neutral.toolActivity) parts.push(a);
  if (neutral.extracted.summary) parts.push(neutral.extracted.summary);
  return parts.join('\n');
}
