import * as claudeCode from './claude-code.js';
import * as codex from './codex.js';
import * as kiro from './kiro.js';
import * as opencode from './opencode.js';

// Single source of truth for "which AI agent CLIs does Mycelium know about" —
// order here is also the agent-picker's display order AND llm.js's
// auto-detect preference (resolveProvider() takes the first one installed).
// kiro sits last on purpose: it's the only CLI with no structured headless
// output, so extractText() has to strip rendered ANSI/markdown to recover a
// reply — workable, but the most fragile of the four, so it's the last
// resort rather than preferred over opencode.
// Adding support for a new agent CLI is: write src/adapters/<name>.js
// implementing the contract documented in base.js, then add it here.
// Nothing else needs to change.
export const ADAPTERS = [claudeCode, codex, opencode, kiro];

/** Look up an adapter by its `name` (== a session's `source` field). */
export function getAdapter(source) {
  return ADAPTERS.find((a) => a.name === source);
}
