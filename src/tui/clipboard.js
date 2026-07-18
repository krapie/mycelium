import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function which(cmd) {
  return (process.env.PATH || '').split(':').some((p) => p && existsSync(`${p}/${cmd}`));
}

/**
 * Copy text to the system clipboard. blessed's mouse tracking blocks normal
 * terminal text selection, so the TUI offers an explicit copy instead. Tries
 * pbcopy (macOS), then wl-copy / xclip / xsel (Linux). Returns true on success.
 */
export function copyToClipboard(text) {
  const tools = [
    ['pbcopy', []],
    ['wl-copy', []],
    ['xclip', ['-selection', 'clipboard']],
    ['xsel', ['--clipboard', '--input']],
  ];
  for (const [bin, args] of tools) {
    if (!which(bin)) continue;
    const r = spawnSync(bin, args, { input: text });
    if (r.status === 0) return true;
  }
  return false;
}
