'use strict';
const vscode = require('vscode');
const { terminalColor } = require('./items.js');
const { commandFor } = require('./shell.js');

/** A fresh terminal tab per launch — several agents can run side by side — colored by agent so they stay apart. */
function openTerminal({ name, cwd, bin, args, key }) {
  const term = vscode.window.createTerminal({ name, cwd, iconPath: new vscode.ThemeIcon('sparkle'), color: terminalColor(key) });
  term.show();
  term.sendText(commandFor(vscode.env.shell, bin, args));
}

module.exports = { openTerminal };
