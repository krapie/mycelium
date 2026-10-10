import { resolve } from 'node:path';
import { fail, parseFlags } from './util.js';

const MODE_TEXT = {
  push: 'sends its sessions to the remote, takes nothing back',
  'two-way': 'exchanges changes with the remote both ways',
  collect: "gathers every machine's sessions into this store",
};

function report(r) {
  if (r.skipped) return console.log(`sync skipped: ${r.skipped}`);
  if (!r.ok) fail(`sync failed: ${r.error}`);
  if (r.sentOnly) return console.log('sent — this machine\'s sessions are on the remote (nothing is taken back)');
  const n = r.changed === null ? 'all sessions reindexed' : `${r.changed.length} session(s) updated from other machines`;
  console.log(`synced — ${n}`);
}

export async function syncCmd(args) {
  const { flags, positional } = parseFlags(args);
  const [sub, ...rest] = positional;
  const sync = await import('../sync.js');

  // Called by git itself during a merge (see sync/git.js's
  // registerMergeDrivers()), never by a person.
  if (sub === 'merge-driver') {
    const [kind, base, ours, theirs, pathname] = rest;
    process.exit(sync.runMergeDriver(kind, base, ours, theirs, pathname));
  }

  if (sub === 'host') {
    if (!rest[0]) fail('usage: mycelium sync host <path>');
    const path = resolve(rest[0]);
    const r = await sync.createHostRepo(path);
    if (!r.ok) fail(r.error);
    console.log(`${r.existed ? 'already a sync repo' : 'created sync repo'}: ${path}`);
    console.log(`on this machine (collects everyone's sessions):  mycelium sync init ${path} --collect --worker`);
    console.log(`on other machines (send theirs here):            mycelium sync init ssh://<user>@<this-host>${path}`);
    console.log('(add --two-way on another machine to also receive everything the others have)');
    return;
  }

  if (sub === 'init') {
    if (!rest[0]) fail('usage: mycelium sync init <git-url> [--collect | --two-way] [--worker] [--propagate-deletes]');
    if (flags.collect && flags['two-way']) fail('pick one of --collect and --two-way');
    if (!(await sync.hasGit())) fail('git is not installed — sync needs it');
    const mode = flags.collect ? 'collect' : flags['two-way'] ? 'two-way' : 'push';
    const r = await sync.initRepo(rest[0], { worker: !!flags.worker, mode, propagateDeletes: !!flags['propagate-deletes'] });
    if (!r.ok) fail(r.error);
    console.log(`sync set up → ${rest[0]} (${MODE_TEXT[mode]})`);
    return report(await sync.syncOnce());
  }

  if (sub === 'mode') {
    if (!sync.syncSettings()) fail('sync is not set up — run mycelium sync init <git-url> first');
    if (rest[0]) {
      if (!sync.SYNC_MODES.includes(rest[0])) fail(`mode must be one of: ${sync.SYNC_MODES.join(', ')}`);
      sync.updateSyncSettings({ mode: rest[0] });
    }
    return console.log(`${sync.syncMode()} — ${MODE_TEXT[sync.syncMode()]}`);
  }

  // Only the collecting machine ever acts on this: a pushing machine's own
  // deletions never reach its remote store unless this is on there.
  if (sub === 'deletes') {
    if (!sync.syncSettings()) fail('sync is not set up — run mycelium sync init <git-url> first');
    if (rest[0] === 'keep' || rest[0] === 'propagate') sync.updateSyncSettings({ propagateDeletes: rest[0] === 'propagate' });
    const on = !!sync.syncSettings().propagateDeletes;
    return console.log(on ? 'propagate — sessions deleted on a pushing machine are deleted here too' : 'keep — sessions deleted on a pushing machine stay here');
  }

  if (sub === 'worker') {
    if (!sync.syncSettings()) fail('sync is not set up — run mycelium sync init <git-url> first');
    if (rest[0] === 'on' || rest[0] === 'off') sync.setWorker(rest[0] === 'on');
    console.log(`LLM upkeep on this machine: ${sync.isLlmWorker() ? 'on' : 'off'}`);
    return;
  }

  // Path prefixes differ between machines (/Users/me vs /home/me); handoff
  // uses this to open a synced session's work in the right place here.
  if (sub === 'map') {
    const { loadConfig, saveConfig } = await import('../config.js');
    const cfg = loadConfig();
    if (rest.length === 2) {
      saveConfig({ ...cfg, pathMap: { ...cfg.pathMap, [rest[0]]: rest[1] } });
    } else if (rest.length) fail('usage: mycelium sync map [<other-machine-path> <this-machine-path>]');
    const map = loadConfig().pathMap || {};
    if (!Object.keys(map).length) return console.log('no path mappings');
    for (const [from, to] of Object.entries(map)) console.log(`${from} → ${to}`);
    return;
  }

  if (sub === 'status') {
    const s = sync.syncSettings();
    if (!s) return console.log('sync is not set up (mycelium sync init <git-url>)');
    const { machineName } = await import('../config.js');
    const pending = (await sync.git(['status', '--porcelain'])).stdout.split('\n').filter(Boolean).length;
    const last = (await sync.git(['log', '-1', '--format=%cr by %an'])).stdout;
    console.log(`remote:   ${s.remote}`);
    console.log(`machine:  ${machineName()} — ${sync.syncMode()}: ${MODE_TEXT[sync.syncMode()]}`);
    console.log(`upkeep:   LLM upkeep ${sync.isLlmWorker() ? 'on' : 'off'} on this machine`);
    console.log(`last:     ${last || 'never'}`);
    console.log(`unsynced: ${pending} file(s)`);
    return;
  }

  if (sub && sub !== 'now') fail(`unknown sync command: ${sub}`);
  if (!sync.syncSettings()) fail('sync is not set up — run mycelium sync init <git-url> first');
  report(await sync.syncOnce());
}
