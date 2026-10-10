import { openSync, closeSync, statSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';
import { HOME, SYNC_LOCK_PATH } from '../paths.js';
import { machineName } from '../config.js';
import { loadRaw } from '../scanner.js';
import { reindex, reindexOne, removeFromIndex } from '../index-db.js';
import { git, syncSettings, syncMode, machineBranch, registerMergeDrivers, BRANCH } from './git.js';
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
// happens to be configured (a home server often has none at all).
function asMachine() {
  const me = machineName();
  return ['-c', `user.name=${me}`, '-c', `user.email=${me}@mycelium.local`];
}

async function commitAll(message) {
  await git(['add', '-A']);
  if ((await git(['diff', '--cached', '--quiet'])).ok) return false;
  return (await git([...asMachine(), 'commit', '-q', '-m', message])).ok;
}

/**
 * A file one machine deleted and the other edited: the deletion wins. A
 * delete is a deliberate act (deleteSession() also records the id in
 * excluded.txt), and a consumed backlog item is deleted on purpose too.
 * `keepTheirEdits` is for merging a pushing machine into the central store
 * (collect): a deletion THERE doesn't reach this store, so a file they
 * deleted and we edited stays.
 */
async function resolveDeleteConflicts({ keepOurs = false } = {}) {
  const st = await git(['status', '--porcelain']);
  for (const line of st.stdout.split('\n')) {
    const code = line.slice(0, 2);
    if (code === 'UD' && keepOurs) await git(['add', '--', line.slice(3)]); // deleted by them
    else if (code === 'DU' || code === 'UD') await git(['rm', '-q', '--', line.slice(3)]);
  }
  return !(await git(['diff', '--name-only', '--diff-filter=U'])).stdout;
}

async function mergeRef(ref, { keepOurs = false } = {}) {
  const m = await git([...asMachine(), 'merge', '--no-edit', '-q', '--allow-unrelated-histories', ref]);
  if (m.ok) return { ok: true };
  if (!existsSync(join(HOME, '.git', 'MERGE_HEAD'))) return { ok: false, error: m.stderr || m.stdout };
  if (await resolveDeleteConflicts({ keepOurs })) {
    const c = await git([...asMachine(), 'commit', '-q', '--no-edit']);
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
    await commitAll(`sync: keep sessions deleted on ${ref.replace('origin/machines/', '')}`);
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
 * A pushing machine only ever sends: its store goes to its own branch on the
 * remote, which nobody else writes, so there is nothing to merge and nothing
 * to conflict. Force is safe for the same reason (and needed if the local
 * repo was re-created).
 */
async function pushOnly() {
  await commitAll(`sync: ${machineName()}`);
  const p = await git(['push', '-q', '--force', 'origin', `HEAD:refs/heads/${machineBranch()}`]);
  return p.missing ? { ok: false, error: p.stderr } : p.ok ? { ok: true, changed: [], sentOnly: true } : { ok: false, error: `push failed: ${p.stderr}` };
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
    await commitAll(`sync: ${machineName()}`);
    const before = await head();
    const f = await git(['fetch', '-q', 'origin']);
    if (f.missing) return { ok: false, error: f.stderr };
    if (!f.ok) return { ok: false, error: `fetch failed: ${f.stderr}` };
    const m = await mergeRemote();
    if (!m.ok) return m;
    if (syncMode() === 'collect') {
      const c = await collectPushed();
      if (!c.ok) return c;
    }
    unparkKnowledge();
    await commitAll(`sync: ${machineName()} (knowledge proposals)`);
    let p = await git(['push', '-q', 'origin', `HEAD:${BRANCH}`]);
    if (!p.ok) {
      // Another machine pushed between our fetch and push.
      await git(['fetch', '-q', 'origin']);
      const again = await mergeRemote();
      if (!again.ok) return again;
      p = await git(['push', '-q', 'origin', `HEAD:${BRANCH}`]);
    }
    const changed = await reindexChanged(before, await head());
    if (!p.ok) return { ok: false, changed, error: `push failed: ${p.stderr}` };
    return { ok: true, changed };
  } finally {
    rmSync(SYNC_LOCK_PATH, { force: true });
  }
}
