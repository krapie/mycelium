// Foxfire palette — mycelium glows faint bioluminescent teal in dark humus.
// blessed uses named/hex colors in style objects.
export const C = {
  fox: '#7fe0c4', // bioluminescent accent
  spore: '#d4a24e', // secondary (codex / warnings)
  text: '#e9e4d6',
  dim: '#8b8574',
  faint: '#5e594c',
  bg: '#14140f',
  surface: '#1c1b15',
  border: '#5a5442', // visible against the dark humus bg (was near-invisible #302e24)
};

// Source → accent color for the session dot / label.
export function sourceColor(source) {
  return source === 'codex' ? C.spore : C.fox;
}

export const box = {
  border: { type: 'line' },
  style: { border: { fg: C.border }, fg: C.text },
};
