import * as claudeCode from './claude-code.js';
import * as codex from './codex.js';
import * as kiro from './kiro.js';
import * as opencode from './opencode.js';

// Single source of truth for "which AI agent CLIs does Mycelium know about" —
// order here is also the agent-picker's display order. Adding support for a
// new agent CLI is: write src/adapters/<name>.js implementing the contract
// documented in base.js, then add it here. Nothing else needs to change.
export const ADAPTERS = [claudeCode, codex, kiro, opencode];

/** Look up an adapter by its `name` (== a session's `source` field). */
export function getAdapter(source) {
  return ADAPTERS.find((a) => a.name === source);
}
