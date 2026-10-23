/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

import { openSync, closeSync, statSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';
import { HOME, SYNC_LOCK_PATH } from '../paths.js';
import { machineName } from '../config.js';
import { loadRaw } from '../scanner.js';
import { reindex, reindexOne, removeFromIndex } from '../index-db.js';
import { git, syncSettings, syncMode, machineBranch, updateSyncSettings, registerMergeDrivers, BRANCH, NET_TIMEOUT_MS } from './git.js';
import { mergeSession } from './merge.js';

// Both the TUI's in-process upkeep and a detached `mycelium daemon` can run on
// one machine; two git processes in one repo fail on index.lock at best and
// interleave a commit with a merge at worst.
const LOCK_STALE_MS = 10 * 60 * 1000;

function takeLock() {
  try {
    closeSync(openSync(SYNC_LOCK_PATH, 'wx'));
    return true;
  } catch {
    try {
      if (Date.now() - statSync(SYNC_LOCK_PATH).mtimeMs < LOCK_STALE_MS) return false;
      rmSync(SYNC_LOCK_PATH, { force: true }); // left behind by a crashed sync
      closeSync(openSync(SYNC_LOCK_PATH, 'wx'));
      return true;
    } catch {
      return false;
    }
  }
}

// Where the knowledge driver parks the other machine's KNOWLEDGE.md until the
// merge has finished — writing into tree/ mid-merge would race git's own
// checkout of the same directory.
const PARKED_DIR = join(HOME, '.git', 'mycelium-knowledge');

/**
 * Body of `mycelium sync merge-driver <kind> %O %A %B %P`. git reads the
 * merged result back from `ours`; exit status 0 means "merged cleanly".
 */
export function runMergeDriver(kind, basePath, oursPath, theirsPath, pathname) {
  if (kind === 'theirs') {
    writeFileSync(oursPath, readFileSync(theirsPath));
    return 0;
  }
  if (kind === 'knowledge') {
    // Keep this machine's KNOWLEDGE.md and turn the other one into a pending
    // proposal, which the TUI's `k` review already knows how to show.
    const parked = join(PARKED_DIR, pathname);
    mkdirSync(dirname(parked), { recursive: true });
    writeFileSync(parked, readFileSync(theirsPath));
    return 0;
  }
  try {
    const read = (p) => {
      const text = readFileSync(p, 'utf8');
      return text.trim() ? JSON.parse(text) : null;
    };
    const merged = mergeSession(read(basePath), read(oursPath), read(theirsPath));
    writeFileSync(oursPath, JSON.stringify(merged, null, 2));
    return 0;
  } catch {
    return 1; // unparseable side — leave it as a real conflict
  }
}

function unparkKnowledge() {
  if (!existsSync(PARKED_DIR)) return;
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const rel = relative(PARKED_DIR, p);
        const pending = join(HOME, dirname(rel), basename(rel).replace(/\.md$/, '.pending.md'));
        mkdirSync(dirname(pending), { recursive: true });
        writeFileSync(pending, readFileSync(p));
      }
    }
  };
  walk(PARKED_DIR);
  rmSync(PARKED_DIR, { recursive: true, force: true });
}

async function head() {
  const r = await git(['rev-parse', '--verify', '-q', 'HEAD']);
  return r.ok ? r.stdout : null;
}

// Commits are authored by the machine, not whoever's global git identity
// happens to be configured (a home server often has none at all), and never
// signed: a global commit.gpgsign=true would make every unattended commit
// fail or wait on a passphrase.
function asMachine() {
  const me = machineName();
  return ['-c', `user.name=${me}`, '-c', `user.email=${me}@mycelium.local`, '-c', 'commit.gpgsign=false'];
}

/**
 * Commit whatever changed. `{ ok: true }` when that worked or there was
 * nothing to commit. A failure is returned, not swallowed: pushing the old
 * HEAD and reporting "sent" would silently leave new sessions behind.
 * --no-verify so a user's own pre-commit hook can't block the daemon.
 */
async function commitAll(message) {
  const a = await git(['add', '-A']);
  if (!a.ok) return { ok: false, error: `git add failed: ${a.stderr}` };
  if ((await git(['diff', '--cached', '--quiet'])).ok) return { ok: true };
  const c = await git([...asMachine(), 'commit', '-q', '--no-verify', '-m', message]);
  return c.ok ? { ok: true } : { ok: false, error: `commit failed: ${c.stderr}` };
}

/**
 * A file one machine deleted and the other edited: the deletion wins. A
 * delete is a deliberate act (deleteSession() also records the id in
 * excluded.txt), and a consumed backlog item is deleted on purpose too.
 * `keepOurs` is for merging a pushing machine into the central store
 * (collect): a deletion THERE doesn't reach this store, so a file they
 * deleted and we edited stays.
 *
 * -z because the default porcelain output quotes (and octal-escapes) any
 * path with a space or non-ASCII character, e.g. a Korean folder name, and
 * the quoted form isn't a path `git rm`/`git add` accept.
 */
async function resolveDeleteConflicts({ keepOurs = false } = {}) {
  const st = await git(['status', '--porcelain', '-z']);
  for (const entry of st.stdout.split('\0')) {
    const code = entry.slice(0, 2);
    const path = entry.slice(3);
    if (code === 'UD' && keepOurs) await git(['add', '--', path]); // deleted by them
    else if (code === 'DU' || code === 'UD') await git(['rm', '-q', '--', path]);
  }
  return !(await git(['diff', '--name-only', '--diff-filter=U'])).stdout;
}

async function mergeRef(ref, { keepOurs = false } = {}) {
  const m = await git([...asMachine(), 'merge', '--no-edit', '-q', '--allow-unrelated-histories', ref]);
  if (m.ok) return { ok: true };
  if (!existsSync(join(HOME, '.git', 'MERGE_HEAD'))) return { ok: false, error: m.stderr || m.stdout };
  if (await resolveDeleteConflicts({ keepOurs })) {
    const c = await git([...asMachine(), 'commit', '-q', '--no-edit', '--no-verify']);
    if (c.ok) return { ok: true };
  }
  await git(['merge', '--abort']);
  return { ok: false, error: `merge conflict left unresolved — kept this machine's copy (${m.stderr || m.stdout})` };
}

async function mergeRemote() {
  if (!(await git(['rev-parse', '--verify', '-q', `origin/${BRANCH}`])).ok) return { ok: true }; // empty remote
  return mergeRef(`origin/${BRANCH}`);
}

/**
 * Fold every other machine's pushed branch into this (central) store.
 * A session a pushing machine deleted is NOT deleted here unless the user
 * opted in (`propagateDeletes`): the central store is the archive, so a
 * clean-up on one laptop must not erase the copy that was sent to keep.
 * Only raw/ is restored — a folder the pusher renamed or removed is
 * structure, and follows them.
 */
async function collectPushed() {
  const keepDeletes = !syncSettings()?.propagateDeletes;
  const refs = (await git(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin/machines/'])).stdout
    .split('\n')
    .filter(Boolean);
  for (const ref of refs) {
    if (ref === `origin/${machineBranch()}`) continue;
    if ((await git(['merge-base', '--is-ancestor', ref, 'HEAD'])).ok) continue; // nothing new
    const pre = await head();
    const m = await mergeRef(ref, { keepOurs: keepDeletes });
    if (!m.ok) return m;
    if (!keepDeletes || !pre) continue;
    const gone = (await git(['diff', '--name-only', '--diff-filter=D', pre, 'HEAD', '--', 'raw/'])).stdout
      .split('\n')
      .filter(Boolean);
    if (!gone.length) continue;
    await git(['checkout', pre, '--', ...gone]);
    const kept = await commitAll(`sync: keep sessions deleted on ${ref.replace('origin/machines/', '')}`);
    if (!kept.ok) return kept;
  }
  return { ok: true };
}

/** Bring the index in line with whatever the merge changed in raw/. */
async function reindexChanged(before, after) {
  if (!before) {
    reindex();
    return null; // everything may have changed
  }
  if (before === after) return [];
  const diff = await git(['diff', '--name-status', '--no-renames', before, after, '--', 'raw/']);
  const ids = [];
  for (const line of diff.stdout.split('\n')) {
    const [status, path] = line.split('\t');
    if (!path) continue;
    const id = basename(path, '.json');
    if (status === 'D') removeFromIndex(id);
    else {
      const n = loadRaw(id);
      if (n) reindexOne(n);
    }
    ids.push(id);
  }
  return ids;
}

/**
 * Branches this machine pushed under a name it no longer has (renameMachine()
 * lists them). Only removed after the new branch is safely on the remote, and
 * kept listed until the delete actually worked, so a pass that couldn't reach
 * the remote tries again.
 */
async function deleteStaleBranches() {
  const stale = syncSettings()?.staleBranches || [];
  const left = [];
  for (const b of stale) {
    const d = await git(['push', '-q', 'origin', '--delete', `refs/heads/${b}`], { timeout: NET_TIMEOUT_MS });
    if (!d.ok && !/does not exist|not exist/.test(d.stderr)) left.push(b);
  }
  if (left.length !== stale.length) updateSyncSettings({ staleBranches: left });
}

/**
 * A pushing machine only ever sends: its store goes to its own branch on the
 * remote, which nobody else writes, so there is nothing to merge and nothing
 * to conflict. Force is safe for the same reason (and needed if the local
 * repo was re-created).
 */
async function pushOnly() {
  const c = await commitAll(`sync: ${machineName()}`);
  if (!c.ok) return c;
  const p = await git(['push', '-q', '--force', 'origin', `HEAD:refs/heads/${machineBranch()}`], { timeout: NET_TIMEOUT_MS });
  if (p.missing) return { ok: false, error: p.stderr };
  if (!p.ok) return { ok: false, error: `push failed: ${p.stderr}` };
  await deleteStaleBranches();
  return { ok: true, changed: [], sentOnly: true };
}

/**
 * One sync pass, by mode (git.js's syncMode()): a pushing machine sends its
 * store; a two-way machine commits local changes, merges the remote's and
 * pushes the result; the central machine does the two-way pass and also
 * folds in every pushing machine's branch. Then reindexes exactly the
 * sessions the merge touched. Safe to call when sync isn't set up (no-op) or
 * while another pass is running (skipped).
 * Returns { ok, changed } — `changed` is the session ids pulled in, or null
 * after a full reindex.
 */
export async function syncOnce() {
  if (!syncSettings()) return { ok: true, skipped: 'not set up' };
  if (process.env.MYCELIUM_DEMO_MODE === '1') return { ok: true, skipped: 'demo' };
  if (!takeLock()) return { ok: true, skipped: 'another sync is running' };
  try {
    await registerMergeDrivers();
    if (syncMode() === 'push') return await pushOnly();
    const committed = await commitAll(`sync: ${machineName()}`);
    if (!committed.ok) return committed;
    const before = await head();
    // --prune: a pushing machine that was renamed deletes its old branch.
    const f = await git(['fetch', '-q', '--prune', 'origin'], { timeout: NET_TIMEOUT_MS });
    if (f.missing) return { ok: false, error: f.stderr };
    if (!f.ok) return { ok: false, error: `fetch failed: ${f.stderr}` };
    const m = await mergeRemote();
    if (!m.ok) return m;
    if (syncMode() === 'collect') {
      const c = await collectPushed();
      if (!c.ok) return c;
    }
    unparkKnowledge();
    const proposals = await commitAll(`sync: ${machineName()} (knowledge proposals)`);
    if (!proposals.ok) return proposals;
    let p = await git(['push', '-q', 'origin', `HEAD:${BRANCH}`], { timeout: NET_TIMEOUT_MS });
    if (!p.ok && !p.timedOut) {
      // Rejected: another machine pushed between our fetch and push.
      const again = await git(['fetch', '-q', 'origin'], { timeout: NET_TIMEOUT_MS });
      if (!again.ok) return { ok: false, error: `fetch failed: ${again.stderr}` };
      const merged = await mergeRemote();
      if (!merged.ok) return merged;
      p = await git(['push', '-q', 'origin', `HEAD:${BRANCH}`], { timeout: NET_TIMEOUT_MS });
    }
    const changed = await reindexChanged(before, await head());
    if (!p.ok) return { ok: false, changed, error: `push failed: ${p.stderr}` };
    return { ok: true, changed };
  } finally {
    rmSync(SYNC_LOCK_PATH, { force: true });
  }
}
