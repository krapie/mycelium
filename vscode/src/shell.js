/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

'use strict';
const path = require('node:path');

/** posix | powershell | cmd, from the integrated terminal's shell path. */
function shellKind(shellPath) {
  const name = path.win32.basename(path.posix.basename(String(shellPath || ''))).toLowerCase().replace(/\.exe$/, '');
  if (name === 'pwsh' || name === 'powershell') return 'powershell';
  if (name === 'cmd') return 'cmd';
  return 'posix';
}

// Arguments here can come from a transcript (a handoff prompt), so quoting is
// a security boundary, not a nicety: a prompt must never be able to end its
// own quotes and run what follows.

// cmd.exe has no reliable way to quote a `"`, `%`, `^`, `&`, newline… (`\"` is
// the target program's rule, not cmd's, so a quote can close the string early
// and let `&` run a command). Rather than try, only words made of harmless
// characters are written for cmd at all; anything else is run in PowerShell
// instead (needsFallbackShell).
const CMD_SAFE = /^[\w.\\/:=@+, -]*$/;

const QUOTE = {
  posix: (s) => (/^[\w./:=@%+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`),
  // Single-quoted means nothing inside expands — but PowerShell also treats the
  // typographic single quotes (U+2018 ‘ U+2019 ’ U+201A ‚ U+201B ‛) as quote
  // characters, and prose is full of them. Every one is doubled, like '.
  powershell: (s) => `'${s.replace(/['\u2018\u2019\u201A\u201B]/g, (c) => c + c)}'`,
  cmd: (s) => {
    if (!CMD_SAFE.test(s)) throw new Error('cmd cannot safely quote this argument');
    return /^[\w.\\/:=@+,-]+$/.test(s) ? s : `"${s}"`;
  },
};

/** True when this shell can't safely be given these arguments and the launch must use PowerShell. */
function needsFallbackShell(shellPath, bin, args = []) {
  return shellKind(shellPath) === 'cmd' && ![bin, ...args].every((a) => CMD_SAFE.test(a));
}

/**
 * The line to type into a terminal to run `bin args…` in that terminal's own
 * shell. The working directory is not part of it: the terminal is created
 * with `cwd`, which needs no quoting rules at all.
 */
function commandFor(shellPath, bin, args = []) {
  const kind = shellKind(shellPath);
  const q = QUOTE[kind];
  const rest = args.map(q).join(' ');
  // `&` is PowerShell's call operator; it is what lets a quoted program name run.
  const head = kind === 'powershell' ? `& ${q(bin)}` : q(bin);
  return rest ? `${head} ${rest}` : head;
}

module.exports = { shellKind, commandFor, needsFallbackShell };
