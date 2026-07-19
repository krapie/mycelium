// Foxfire palette — mycelium glows faint bioluminescent teal in dark humus.
// blessed uses named/hex colors in style objects.
export const C = {
  fox: '#7fe0c4', // bioluminescent accent — reserved for titles/focus, not agent labels
  spore: '#d4a24e', // secondary (codex / warnings)
  claude: '#8ab4d8', // claude-code agent label — was fox, same as the title color it sits next to
  tag: '#c9a3d9', // session tags — distinct from title (fox), claude, and spore/codex
  text: '#e9e4d6',
  dim: '#8b8574',
  faint: '#5e594c',
  bg: '#14140f',
  surface: '#1c1b15',
  border: '#5a5442', // visible against the dark humus bg (was near-invisible #302e24)
};

// Source → accent color for the session dot / label. Kept distinct from
// C.fox (used for session titles) so the agent label never visually merges
// with the title it's printed next to.
export function sourceColor(source) {
  return source === 'codex' ? C.spore : C.claude;
}

export const box = {
  border: { type: 'line' },
  style: { border: { fg: C.border }, fg: C.text },
};
