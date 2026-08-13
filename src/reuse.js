import { join } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { TREE_DIR } from './paths.js';
import { loadRaw, allRaw } from './scanner.js';
import { isInSubtree } from './organize.js';
import { contentLocale } from './config.js';

const BEGIN = '<!-- mycelium:begin -->';
const END = '<!-- mycelium:end -->';
const CLAUDE_BRIDGE = '@AGENTS.md';

/**
 * Distinct existing working directories of the sessions in a folder subtree
 * — moved here from tui/launch.js (which still uses it for `n`/`Shift+N`'s
 * launch-target picker) because daemon/cycles.js's digestCycle needs it too,
 * for auto-injecting an approved knowledge refresh into every directory a
 * folder's sessions actually ran in — and core (daemon/**) must never import
 * from tui/**.
 */
export function dirsForFolder(folder) {
  if (!folder) return [];
  const set = new Set();
  for (const n of allRaw()) {
    if (!isInSubtree(n.folder, folder)) continue;
    const d = n.projectDir || n.cwd;
    if (d && existsSync(d)) set.add(d);
  }
  return [...set];
}

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

/**
 * Render ancestor-path knowledge into a marker block inside the target dir's
 * AGENTS.md. AGENTS.md is read natively by Codex (walks up the directory
 * tree, plus a separate global ~/.codex/AGENTS.md) and read as steering
 * context by Kiro (though a still-open upstream bug —
 * kirodotdev/Kiro#6755 — means it's sometimes *listed* as loaded context
 * without actually being read; nothing Mycelium can work around from here).
 * **Claude Code does not read AGENTS.md at all** — confirmed against
 * Anthropic's own current docs, it only ever auto-loads CLAUDE.md — so
 * writing AGENTS.md alone would make the entire inject/n/h "self-improving
 * loop" silently do nothing for a Claude Code session. ensureClaudeBridge()
 * below closes that gap unconditionally (not gated on which agent is about
 * to run — cheap and harmless either way, and covers manual `i`-key inject,
 * which doesn't know the target agent up front).
 *
 * Only the marker block (AGENTS.md) / the bridge import (CLAUDE.md) is ever
 * touched; the rest of either file's own content is never modified.
 */
export function injectAgentsMd(targetDir, folderPath) {
  const context = assembleContext(folderPath);
  if (!context) return { ok: false, error: `no KNOWLEDGE.md along ${folderPath}` };

  // Follows config.js's contentLocale(), same convention as the LLM prompts
  // (AGENTS.md's "Human-facing text") — this one line is the only part of
  // the injected block Mycelium itself writes rather than quoting verbatim
  // from a KNOWLEDGE.md the user/LLM already produced in their locale.
  const marker =
    contentLocale() === 'ko'
      ? '<!-- Mycelium이 관리하는 영역입니다. 직접 수정하지 마세요. -->'
      : '<!-- Managed by Mycelium. Do not edit directly. -->';
  const block = `${BEGIN}\n${marker}\n\n${context}\n${END}`;
  const path = join(targetDir, 'AGENTS.md');

  let content = '';
  if (existsSync(path)) content = readFileSync(path, 'utf8');

  if (content.includes(BEGIN) && content.includes(END)) {
    content = content.replace(new RegExp(`${BEGIN}[\\s\\S]*?${END}`), block);
  } else {
    content = content.trim() ? `${content.trim()}\n\n${block}\n` : `${block}\n`;
  }
  writeFileSync(path, content);
  ensureClaudeBridge(targetDir);
  return { ok: true, path, folder: folderPath };
}

/**
 * Make sure targetDir's CLAUDE.md actually pulls in AGENTS.md — see
 * injectAgentsMd()'s own doc comment for why this exists at all. Idempotent
 * (a repeat call is a no-op once the bridge line is present, so this can run
 * on every single inject without ever duplicating it) and additive — an
 * existing CLAUDE.md's own content is never rewritten or reordered, only
 * prepended to, same "never touch what's already there" discipline
 * injectAgentsMd() itself applies to AGENTS.md.
 */
function ensureClaudeBridge(targetDir) {
  const path = join(targetDir, 'CLAUDE.md');
  let content = '';
  if (existsSync(path)) content = readFileSync(path, 'utf8');
  if (content.includes(CLAUDE_BRIDGE)) return; // already bridged

  const bridge = `<!-- Claude Code doesn't read AGENTS.md on its own — see https://agents.md -->\n${CLAUDE_BRIDGE}\n`;
  content = content.trim() ? `${bridge}\n${content.trim()}\n` : bridge;
  writeFileSync(path, content);
}

/** Assemble the context a session would inherit (for `mycelium context`). */
export function contextForSession(sessionId) {
  const n = loadRaw(sessionId);
  if (!n) return { ok: false, error: `no session ${sessionId}` };
  return { ok: true, folder: n.folder, context: assembleContext(n.folder) };
}
