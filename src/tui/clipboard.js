import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function which(cmd) {
  return (process.env.PATH || '').split(':').some((p) => p && existsSync(`${p}/${cmd}`));
}

// Injection seam, same shape (and same reason) as llm.js's __setTestProvider:
// an e2e test that drives a real "copy command" path would otherwise overwrite
// the clipboard of whoever is running the suite. Production is untouched when
// no writer is set.
let testWriter = null;
export function __setTestClipboard(fn) {
  testWriter = fn;
}
export function __clearTestClipboard() {
  testWriter = null;
}

/**
 * Copy text to the system clipboard. blessed's mouse tracking blocks normal
 * terminal text selection, so the TUI offers an explicit copy instead. Tries
 * pbcopy (macOS), then wl-copy / xclip / xsel (Linux). Returns true on success.
 */
export function copyToClipboard(text) {
  if (testWriter) return testWriter(text) !== false;
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
