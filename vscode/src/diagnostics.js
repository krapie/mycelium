/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

'use strict';

/**
 * The text behind *Mycelium: Copy Diagnostics*. It has to work when the CLI
 * does not, since that is when it is needed: the editor's own facts are
 * always included, the CLI's `doctor` report only when it answered.
 * `home` is printed as `~` so the text can go into an issue as is.
 */
function formatDiagnostics({ editor, resolved, loginDirs = [], cli, cliError, home }) {
  const hide = (s) => (home && typeof s === 'string' ? s.split(home).join('~') : s);
  const lines = [
    `Mycelium for VS Code ${editor.extensionVersion}  |  ${editor.appName} ${editor.vscodeVersion}  |  ${editor.platform}`,
    `remote: ${editor.remoteName || 'none'}  ui language: ${editor.language}`,
    `claude code extension: ${editor.claudeCodeInstalled ? 'installed' : 'not installed'}`,
    `mycelium.path: ${hide(editor.configuredPath) || '(default)'}  mycelium.home: ${hide(editor.configuredHome) || '(default)'}`,
    resolved.from ? `CLI: ${hide(resolved.command)} (found via ${resolved.from})` : `CLI: NOT FOUND. Looked in ${resolved.searched.length} directories`,
    `login shell PATH: ${loginDirs.length ? `${loginDirs.length} directories` : 'none (not asked yet, or the shell gave nothing)'}`,
    `extension host PATH: ${editor.hostPath.length} directories`,
  ];
  if (cliError) lines.push('', `mycelium doctor failed: ${hide(cliError)}`);
  else if (cli) lines.push('', 'mycelium doctor:', JSON.stringify(cli, null, 2).split('\n').map(hide).join('\n'));
  return lines.join('\n');
}

module.exports = { formatDiagnostics };
