'use strict';
const vscode = require('vscode');
const { terminalColor } = require('./items.js');

/** A fresh terminal tab per launch — several agents can run side by side — colored by agent so they stay apart. */
function openTerminal({ name, cwd, line, key }) {
  const term = vscode.window.createTerminal({ name, cwd, iconPath: new vscode.ThemeIcon('sparkle'), color: terminalColor(key) });
  term.show();
  term.sendText(line);
}

module.exports = { openTerminal };
