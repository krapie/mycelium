'use strict';
const path = require('node:path');

/** posix | powershell | cmd, from the integrated terminal's shell path. */
function shellKind(shellPath) {
  const name = path.win32.basename(path.posix.basename(String(shellPath || ''))).toLowerCase().replace(/\.exe$/, '');
  if (name === 'pwsh' || name === 'powershell') return 'powershell';
  if (name === 'cmd') return 'cmd';
  return 'posix';
}

const QUOTE = {
  posix: (s) => (/^[\w./:=@%+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`),
  // Always single-quoted: nothing inside expands, and a ' is doubled.
  powershell: (s) => `'${s.replace(/'/g, "''")}'`,
  // cmd has no way to quote a newline, so a multi-line argument (a handoff
  // prompt) is flattened onto one line; best effort, the default Windows
  // terminal is PowerShell.
  cmd: (s) => {
    const flat = s.replace(/\r?\n/g, ' ');
    return /^[\w.\\/:=@+-]+$/.test(flat) ? flat : `"${flat.replace(/"/g, '\\"')}"`;
  },
};

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

module.exports = { shellKind, commandFor };
