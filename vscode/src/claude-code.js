'use strict';

// Opening a session in the Claude Code extension's own panel instead of a
// terminal. Its public entry point is the URI `vscode://anthropic.claude-code/open
// ?session=<id>&prompt=<text>`, which runs this command with those two values
// (sessionId resumes it; prompt is put in the input box, not sent). Free of
// `vscode`, so the decisions are tested directly.

const EXT_ID = 'anthropic.claude-code';
const PANEL_COMMAND = 'claude-vscode.primaryEditor.open';

// What Claude Code accepts as a session to resume; it ignores anything else,
// so nothing else is sent.
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isSessionId = (id) => SESSION_ID.test(String(id || ''));

/**
 * A session Claude Code itself can resume: one it recorded (source `claude…`),
 * not a merge/split product or backlog note, which have an id of Mycelium's own.
 */
function isClaudeSession(row) {
  return /^claude/.test(String(row.source || '')) && row.kind !== 'backlog' && !(row.mergedFrom && row.mergedFrom.length) && !row.splitFrom && isSessionId(row.id);
}

/**
 * Where a Claude launch goes. `mode` is mycelium.claudeCode.openIn: `auto`
 * follows the Claude Code extension's own choice (its `useTerminal` setting),
 * `panel`/`terminal` force one. Only Claude, and only if its extension is there.
 */
function claudeTarget({ mode = 'auto', installed, useTerminal, agentKey }) {
  if (agentKey !== 'claude' || !installed) return 'terminal';
  if (mode === 'terminal') return 'terminal';
  if (mode === 'panel') return 'panel';
  return useTerminal ? 'terminal' : 'panel';
}

/**
 * A panel request only works in a window that has the session's project open —
 * Claude Code looks a session up through the project of the window it runs in.
 * In any other window (the setting says "this window", or the project's window
 * never answered) the launch goes to a terminal, which carries the directory.
 */
function forWindow(launch, { hasProject }) {
  return hasProject || !launch.panel ? launch : { ...launch, panel: undefined };
}

module.exports = { EXT_ID, PANEL_COMMAND, isSessionId, isClaudeSession, claudeTarget, forWindow };
