import { allRaw, saveRaw } from '../scanner.js';
import { reindex } from '../index-db.js';
import { machineName, setMachineName, isValidMachineName } from '../config.js';
import { syncSettings, syncMode, machineBranch, updateSyncSettings } from './git.js';
import { syncOnce } from './cycle.js';

/**
 * Rename this machine: the config value, every session it captured, and
 * (once synced) the remote. A name is just a label stamped on records, so the
 * relabel is an ordinary edit and reaches the other machines through the same
 * merge as any other change: the pushing machine's branch keeps its history
 * under a new ref name, so the collecting machine's next merge finds the old
 * name as the common ancestor and takes the new one cleanly.
 *
 * Idempotent and crash-safe: records are relabeled before AND after the
 * config changes, so a daemon that saved a record under the old name in
 * between, or a run that died halfway, is mended by running it again.
 */
export async function renameMachine(next) {
  if (!isValidMachineName(next)) {
    return { ok: false, error: `a machine name is 1–32 letters, digits, "." "_" or "-" (got "${next}")` };
  }
  const old = machineName();
  if (next === old) return { ok: true, unchanged: true, name: old };
  if (allRaw().some((n) => n.host === next)) {
    return { ok: false, error: `another machine's sessions already carry the name "${next}"` };
  }

  const relabel = () => {
    let n = 0;
    for (const r of allRaw()) {
      if (r.host !== old) continue;
      r.host = next;
      saveRaw(r);
      n++;
    }
    return n;
  };
  let relabeled = relabel();
  setMachineName(next);
  relabeled += relabel();
  reindex();

  const res = { ok: true, old, name: next, relabeled };
  if (!syncSettings()) return res;
  // A pushing machine's branch is named after it, so the old one is left
  // behind on the remote; syncOnce() deletes it once the new one is pushed.
  if (syncMode() === 'push') {
    updateSyncSettings({ staleBranches: [...new Set([...(syncSettings().staleBranches || []), machineBranch(old)])] });
  }
  return { ...res, sync: await syncOnce() };
}
