import { join } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { TREE_DIR } from './paths.js';
import { autoFolderFor } from './organize.js';
import { loadRaw } from './scanner.js';

const BEGIN = '<!-- mycelium:begin -->';
const END = '<!-- mycelium:end -->';

/**
 * Walk a folder path from the node up to the root, collecting each ancestor's
 * KNOWLEDGE.md. This is deterministic ancestor-path inheritance — the correct
 * context is DEFINED by tree position, not searched for. Same cascade principle
 * as CLAUDE.md/AGENTS.md inheriting down a directory tree.
 */
export function assembleContext(folderPath) {
  if (!folderPath) return '';
  const segments = folderPath.split('/');
  const blocks = [];
  for (let i = 1; i <= segments.length; i++) {
    const partial = segments.slice(0, i);
    const kPath = join(TREE_DIR, ...partial, 'KNOWLEDGE.md');
    if (existsSync(kPath)) {
      blocks.push(readFileSync(kPath, 'utf8').trim());
    }
  }
  return blocks.join('\n\n');
}

/** Map a real working directory to its Mycelium folder (via the same cwd rules as capture). */
export function folderForCwd(cwd) {
  return autoFolderFor({ cwd });
}

/**
 * Render ancestor-path knowledge into a marker block inside the target dir's
 * AGENTS.md. AGENTS.md is read natively by 30+ agents (Codex, Claude Code,
 * Gemini CLI, Cursor …), so this makes "insight → agent memory" work with zero
 * agent-side changes — the cheapest way to prove the self-improving loop.
 * Only the marker block is ever touched; the user's own AGENTS.md content is
 * never modified.
 */
export function injectAgentsMd(targetDir, folderPath) {
  const context = assembleContext(folderPath);
  if (!context) return { ok: false, error: `no KNOWLEDGE.md along ${folderPath}` };

  const block = `${BEGIN}\n<!-- Mycelium이 관리하는 영역입니다. 직접 수정하지 마세요. -->\n\n${context}\n${END}`;
  const path = join(targetDir, 'AGENTS.md');

  let content = '';
  if (existsSync(path)) content = readFileSync(path, 'utf8');

  if (content.includes(BEGIN) && content.includes(END)) {
    content = content.replace(new RegExp(`${BEGIN}[\\s\\S]*?${END}`), block);
  } else {
    content = content.trim() ? `${content.trim()}\n\n${block}\n` : `${block}\n`;
  }
  writeFileSync(path, content);
  return { ok: true, path, folder: folderPath };
}

/** Assemble the context a session would inherit (for `mycelium context`). */
export function contextForSession(sessionId) {
  const n = loadRaw(sessionId);
  if (!n) return { ok: false, error: `no session ${sessionId}` };
  return { ok: true, folder: n.folder, context: assembleContext(n.folder) };
}
