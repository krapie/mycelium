'use strict';
const vscode = require('vscode');
const { EXT_ID, PANEL_COMMAND, isSessionId, claudeTarget } = require('./claude-code.js');
const { openTerminal } = require('./session-terminal.js');

const claudeExtension = () => vscode.extensions.getExtension(EXT_ID);

/** Should a Claude launch open in the Claude Code panel in THIS window? */
function panelWanted(agentKey) {
  return (
    claudeTarget({
      mode: vscode.workspace.getConfiguration('mycelium').get('claudeCode.openIn'),
      installed: !!claudeExtension(),
      useTerminal: vscode.workspace.getConfiguration('claudeCode').get('useTerminal'),
      agentKey,
    }) === 'panel'
  );
}

async function openInClaudePanel({ sessionId, prompt }) {
  if (sessionId !== undefined && !isSessionId(sessionId)) throw new Error('not a Claude Code session id');
  const ext = claudeExtension();
  if (!ext) throw new Error('the Claude Code extension is not installed');
  // Its commands only exist once it has started, and a window opened just for
  // this launch may not have started it yet.
  await ext.activate();
  await vscode.commands.executeCommand(PANEL_COMMAND, sessionId, prompt);
}

/**
 * Start a launch in this window: in the Claude Code panel when it carries a
 * `panel` request and the panel is wanted here, otherwise in a terminal (every
 * launch also carries the command line, so the fallback is always possible).
 */
async function openLaunch(launch) {
  if (launch.panel) {
    if (panelWanted(launch.key)) {
      try {
        await openInClaudePanel(launch.panel);
        return;
      } catch (err) {
        vscode.window.showWarningMessage(`Mycelium: couldn't open it in the Claude Code panel (${err.message}); starting it in a terminal instead.`);
      }
    } else if (vscode.workspace.getConfiguration('mycelium').get('claudeCode.openIn') === 'panel' && !claudeExtension()) {
      // Only when the panel was asked for by name: in `auto`, not having the
      // extension just means a terminal, which is not worth a message.
      vscode.window.showWarningMessage('Mycelium: the Claude Code extension is not installed or enabled in this window, so it is starting in a terminal.');
    }
  }
  openTerminal(launch);
}

module.exports = { openLaunch, openInClaudePanel, panelWanted };
