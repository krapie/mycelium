'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

// Starting a session belongs in the window of the project it ran in. That is
// usually another window, which this one can't talk to directly — so a launch
// request is a small file in a shared folder. Every window's extension watches
// the folder and the one whose project contains the directory takes it by
// deleting it. Deleting is also the acknowledgement the sender waits for, and
// it is atomic, so two windows on the same project can't both start it.
// Free of `vscode`, so it is tested with plain temp directories.

const TTL = 120000; // a request nobody claimed in two minutes is stale

const launchDir = (home = os.homedir()) => path.join(home, '.mycelium-vscode-launch');

// `p` is injectable so the Windows rules (case-insensitive drive letters, `\`)
// are tested from any host.
const within = (child, parent, p) => {
  const rel = p.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !p.isAbsolute(rel));
};

/** Is `dir` part of the same project as one of the open folders (either one containing the other)? */
const relatedTo = (dir, folders, p = path) => folders.some((f) => within(dir, f, p) || within(f, dir, p));

/** Queue a launch; returns the file whose disappearance means "someone took it". */
function enqueue(dir, launch, now = Date.now()) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${now}-${randomBytes(4).toString('hex')}.json`);
  // Written under a name the watcher ignores, then renamed: a reader never sees half a file.
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ ...launch, created: now }));
  fs.renameSync(`${file}.tmp`, file);
  return file;
}

/** Take every fresh request for a directory inside `folders`; drop the stale ones. */
function claim(dir, folders, now = Date.now()) {
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const mine = [];
  for (const name of names) {
    const file = path.join(dir, name);
    let launch;
    try {
      launch = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue; // being renamed into place, or not ours to judge
    }
    // The program and its arguments, not a command line: only the window that
    // runs it knows which shell it has to quote for.
    if (!launch || typeof launch.cwd !== 'string' || typeof launch.bin !== 'string' || !Array.isArray(launch.args) || !launch.args.every((a) => typeof a === 'string')) continue;
    // Optional: the program isn't on PATH, so a terminal can't run it (only the panel can).
    if (launch.binMissing !== undefined && typeof launch.binMissing !== 'boolean') continue;
    // Optional: open in the Claude Code panel rather than a terminal. The
    // command line above stays mandatory — it is the fallback.
    if (launch.panel !== undefined) {
      const p = launch.panel;
      const ok = p && typeof p === 'object' && (p.sessionId === undefined || typeof p.sessionId === 'string') && (p.prompt === undefined || typeof p.prompt === 'string');
      if (!ok) continue;
    }
    if (now - launch.created > TTL) {
      try {
        fs.unlinkSync(file);
      } catch {
        /* someone else cleaned it */
      }
      continue;
    }
    if (!relatedTo(launch.cwd, folders)) continue;
    try {
      fs.unlinkSync(file); // throws if another window got there first
    } catch {
      continue;
    }
    mine.push(launch);
  }
  return mine;
}

const pending = (file) => fs.existsSync(file);

function withdraw(file) {
  try {
    fs.unlinkSync(file);
    return true;
  } catch {
    return false; // claimed after all
  }
}

module.exports = { launchDir, relatedTo, enqueue, claim, pending, withdraw, TTL };
