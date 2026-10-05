// Shared helpers used by every cli/*.js command module.

import { findSession } from '../scanner.js';

export function fail(msg) {
  console.error(msg);
  process.exit(1);
}

export function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else positional.push(a);
  }
  return { flags, positional };
}

// `mycelium list` prints 8-character ids, so every command taking a
// <session> resolves a unique prefix the same way resume/unmerge do (#136).
// Exits on no match or an ambiguous prefix.
export function resolveSessionId(idOrPrefix) {
  const found = findSession(idOrPrefix);
  if (!found.ok) fail(found.error);
  return found.session.id;
}
