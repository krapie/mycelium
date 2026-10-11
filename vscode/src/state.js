'use strict';
const vscode = require('vscode');

// Context keys drive the `when` clauses in the manifest (welcome views, the
// walkthrough's completion events). Set only on change: each call is an IPC.
const last = {};
function setContext(key, value) {
  if (last[key] === value) return;
  last[key] = value;
  vscode.commands.executeCommand('setContext', key, value);
}

const state = { home: null, language: vscode.env.language };

let lastMessage = '';
function markConnected() {
  setContext('mycelium.cliMissing', false);
  setContext('mycelium.connected', true);
}

/** A failed request from a view: a missing CLI becomes a welcome view, anything else one error toast. */
function handleError(err) {
  if (err && err.code === 'ENOENT') {
    setContext('mycelium.cliMissing', true);
    setContext('mycelium.connected', false);
    return;
  }
  if (err.message !== lastMessage) {
    lastMessage = err.message;
    vscode.window.showErrorMessage(`Mycelium: ${err.message}`);
  }
}

module.exports = { state, setContext, markConnected, handleError };
