import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME, ensureDirs } from '../paths.js';
import { loadConfig, saveConfig, excludedIds, machineName } from '../config.js';
import { allRaw, saveRaw } from '../scanner.js';
import { keepEmptyFolders } from '../organize.js';

// The store is synced by running the user's own `git` — the same way llm.js
// shells out to their own claude/codex instead of bundling a client. The
// user never runs git by hand: `mycelium sync init` sets the repo up and the
// daemon (daemon/cycles.js) keeps it in sync.

export const BRANCH = 'main';

// Machine-local files. db/ is a derived index that every machine rebuilds
// from raw/ (and sqlite files corrupt when merged as blobs); config.json
// holds per-machine choices like locale, machineName and the worker flag.
const GITIGNORE = ['db/', 'config.json', 'daemon.pid', 'daemon.log', 'sync.lock', ''].join('\n');

const GITATTRIBUTES = [
  'raw/*.json merge=mycelium-session',
  'tree/**/KNOWLEDGE.md merge=mycelium-knowledge',
  'tree/**/KNOWLEDGE.pending.md merge=mycelium-theirs',
  'digests/** merge=mycelium-theirs',
  'excluded.txt merge=union',
  '',
].join('\n');

/**
 * Run git in the store. Never throws for a non-zero exit — callers decide
 * what a failure means. `batch` keeps ssh from prompting: the daemon runs
 * inside the TUI, where a password prompt would corrupt the screen and hang
 * the sync forever.
 */
export function git(args, { batch = true } = {}) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  if (batch && !process.env.GIT_SSH_COMMAND) env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes';
  return new Promise((resolve) => {
    execFile('git', args, { cwd: HOME, env, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err?.code === 'ENOENT') return resolve({ ok: false, missing: true, stdout: '', stderr: 'git is not installed' });
      resolve({ ok: !err, stdout: String(stdout).trim(), stderr: String(stderr).trim() });
    });
  });
}

export async function hasGit() {
  return !(await git(['--version'])).missing;
}

/** Sync is on once `mycelium sync init` has recorded a remote for this machine. */
export function syncSettings() {
  const s = loadConfig().sync;
  return s?.remote ? s : null;
}

/**
 * How this machine syncs:
 *  - 'push' (the default for new setups): sends its own store to the remote
 *    and never takes anything back, so it holds only what it captured itself.
 *  - 'collect': the central machine — merges every machine's push (plus
 *    two-way machines' changes) into one store, which only it holds in full.
 *  - 'two-way': exchanges changes with the remote both ways, so every
 *    two-way machine ends up with everything.
 * Setups made before modes existed were two-way.
 */
export const SYNC_MODES = ['push', 'two-way', 'collect'];

export function syncMode() {
  return syncSettings()?.mode || 'two-way';
}

/**
 * Whether this machine runs the automatic LLM upkeep (summaries, smart
 * organize, digests, knowledge review). A pushing machine always does: it
 * receives nothing from anywhere else, so nobody else will summarize its
 * sessions. Two-way and collect machines share one store, so exactly one of
 * them (`--worker`) does it, or every machine would pay for the same calls.
 */
export function isLlmWorker() {
  const s = syncSettings();
  return !s || s.mode === 'push' || !!s.worker;
}

/** Settings are stored per machine in config.json — see git.js's GITIGNORE. */
export function updateSyncSettings(patch) {
  const cfg = loadConfig();
  saveConfig({ ...cfg, sync: { ...cfg.sync, ...patch } });
}

export function setWorker(on) {
  updateSyncSettings({ worker: !!on });
}

/** One branch per pushing machine on the remote, so pushes never conflict. */
export function machineBranch(name = machineName()) {
  return `machines/${name.replace(/[^\w.-]/g, '_')}`;
}

/**
 * Point git at our merge drivers. Re-run before every sync rather than only
 * at init: the command embeds absolute paths to node and cli.js, which move
 * when Node is upgraded or Mycelium is reinstalled.
 */
export async function registerMergeDrivers() {
  const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
  const cmd = (kind) => `"${process.execPath}" "${cli}" sync merge-driver ${kind} %O %A %B %P`;
  for (const [name, label] of [
    ['mycelium-session', 'Mycelium session record'],
    ['mycelium-knowledge', 'Mycelium KNOWLEDGE.md'],
    ['mycelium-theirs', 'Mycelium generated file'],
  ]) {
    await git(['config', `merge.${name}.name`, label]);
    await git(['config', `merge.${name}.driver`, cmd(name.replace('mycelium-', ''))]);
  }
}

/** `mycelium sync host <path>` — the central repo every machine syncs through. */
export async function createHostRepo(path) {
  if (existsSync(join(path, 'HEAD'))) return { ok: true, existed: true };
  mkdirSync(path, { recursive: true });
  return new Promise((resolve) => {
    execFile('git', ['init', '--bare', '-b', BRANCH, path], (err, _out, stderr) =>
      resolve(err ? { ok: false, error: String(stderr || err.message).trim() } : { ok: true, existed: false }),
    );
  });
}

/**
 * Turn this machine's store into a working copy of `remote`. Everything the
 * store already holds was made on this machine, so records from before the
 * `host` field get stamped now, before the first push could mislabel them.
 * The first sync itself (cycle.js) is what merges this store with whatever
 * the remote already has.
 */
export async function initRepo(remote, { worker = false, mode = 'push', propagateDeletes = false } = {}) {
  ensureDirs();
  if (!existsSync(join(HOME, '.git'))) {
    const r = await git(['init', '-b', BRANCH]);
    if (!r.ok) return { ok: false, error: r.stderr };
  }
  writeFileSync(join(HOME, '.gitignore'), GITIGNORE);
  writeFileSync(join(HOME, '.gitattributes'), GITATTRIBUTES);
  await registerMergeDrivers();
  const hasOrigin = (await git(['remote', 'get-url', 'origin'])).ok;
  const r = await git(hasOrigin ? ['remote', 'set-url', 'origin', remote] : ['remote', 'add', 'origin', remote]);
  if (!r.ok) return { ok: false, error: r.stderr };

  const me = machineName();
  for (const n of allRaw()) {
    if (n.host) continue;
    n.host = me;
    saveRaw(n);
  }
  keepEmptyFolders();
  excludedIds(); // moves an old config.json delete list into the tracked file

  const cfg = loadConfig();
  saveConfig({ ...cfg, sync: { remote, worker, mode, propagateDeletes } });
  return { ok: true };
}
