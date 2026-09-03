import { getAdapter } from '../adapters/index.js';

// Foxfire palette — mycelium glows faint bioluminescent teal in dark humus.
// blessed uses named/hex colors in style objects.
export const C = {
  fox: '#7fe0c4', // bioluminescent accent — reserved for titles/focus, not agent labels
  spore: '#d4a24e', // secondary (codex / warnings)
  claude: '#8ab4d8', // claude-code agent label — was fox, same as the title color it sits next to
  kiro: '#e08fb0', // kiro agent label — distinct from fox/spore/claude/tag
  opencode: '#6bcf8f', // opencode agent label — distinct from fox/spore/claude/kiro/tag
  tag: '#c9a3d9', // session tags — distinct from title (fox), claude, and spore/codex
  merged: '#a8c25a', // merge-product pseudo-source — distinct from every agent color above
  text: '#e9e4d6',
  dim: '#8b8574',
  faint: '#5e594c',
  bg: '#14140f',
  surface: '#1c1b15',
  border: '#5a5442', // visible against the dark humus bg (was near-invisible #302e24)
};

// Source → accent color for the session dot / label. Kept distinct from
// C.fox (used for session titles) so the agent label never visually merges
// with the title it's printed next to. Intentionally hardcoded rather than
// pulled from adapters/index.js — color is a presentation choice a human
// still has to make for any new agent, and adapters (data layer) staying
// free of any tui/ import is worth the one extra line per new source.
export function sourceColor(source) {
  // No source at all = a backlog item (backlog.js) — no agent has been chosen
  // for it yet. Same accent its [Backlog] badge uses.
  if (!source) return C.fox;
  return { codex: C.spore, kiro: C.kiro, opencode: C.opencode, merged: C.merged }[source] ?? C.claude;
}

// Source → display name for the #hashtag-style badge shown next to a
// session's title. Not localized — these are literal tool names (plus
// 'merged', the synthetic merge pseudo-source), same identifier either
// language shows. Derived from the adapter registry (adapters/index.js) —
// a source string IS an adapter's `name` by contract, so there's nothing
// left to duplicate here beyond the 'merged' pseudo-source special case.
export function sourceLabel(source) {
  if (source === 'merged') return 'merged';
  // A backlog item has no source, and this must never hand back null: it goes
  // straight into rendered labels (render.js printed a literal "null #1234abcd"
  // for a session continuing a backlog item) and into sessions.js's
  // sort-by-agent comparator, which called .localeCompare() on it.
  if (!source) return 'backlog';
  return getAdapter(source)?.name ?? source;
}

export const box = {
  border: { type: 'line' },
  style: { border: { fg: C.border }, fg: C.text },
};
