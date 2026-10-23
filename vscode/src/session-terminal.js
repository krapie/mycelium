/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

'use strict';
const vscode = require('vscode');
const { terminalColor } = require('./items.js');
const { commandFor, needsFallbackShell } = require('./shell.js');

/** A fresh terminal tab per launch — several agents can run side by side — colored by agent so they stay apart. */
function openTerminal({ name, cwd, bin, args, key }) {
  // cmd can't be handed an arbitrary prompt safely (shell.js); that one
  // terminal runs in PowerShell, which every Windows has, instead.
  const fallback = needsFallbackShell(vscode.env.shell, bin, args);
  const shell = fallback ? 'powershell.exe' : vscode.env.shell;
  const term = vscode.window.createTerminal({ name, cwd, iconPath: new vscode.ThemeIcon('sparkle'), color: terminalColor(key), ...(fallback ? { shellPath: shell } : {}) });
  term.show();
  term.sendText(commandFor(shell, bin, args));
}

module.exports = { openTerminal };
