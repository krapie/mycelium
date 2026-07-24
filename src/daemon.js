import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scan } from './scanner.js';
import { reindex } from './index-db.js';
import { autoOrganize, summarizeCandidates, suggestPlacements, applyPlacements, queueSuggestions, pendingSuggestions } from './organize.js';
import { tagAll } from './learn.js';
import { generateDigest } from './insight.js';
import { loadConfig } from './config.js';
import { ensureDirs, DAEMON_PID_PATH, DAEMON_LOG_PATH } from './paths.js';

// Headless background worker: keeps the store fresh (scan → organize → tag) and
// generates the daily digest on schedule. The interactive front-end is the TUI
// (`mycelium`); this daemon just does the unattended lifecycle upkeep.
const SCAN_INTERVAL_MS = Number(process.env.MYCELIUM_SCAN_MS || 5 * 60 * 1000);
// Content-based classification is heavier (LLM calls) and less urgent than
// capture, so it runs on its own slower cadence rather than every scan cycle.
const SMART_ORGANIZE_INTERVAL_MS = Number(process.env.MYCELIUM_SMART_ORGANIZE_MS || 30 * 60 * 1000);
// Bounds one cycle's work so a large backlog drains gradually across many
// cycles instead of one run trying to classify everything at once.
const SMART_ORGANIZE_BATCH_LIMIT = Number(process.env.MYCELIUM_SMART_ORGANIZE_LIMIT || 100);

async function scanCycle() {
  try {
    const res = scan();
    if (res.imported > 0) {
      autoOrganize();
      reindex();
      console.log(`[scan] +${res.imported} (organized + reindexed)`);
      // Tag freshly imported sessions (skips those already summarized).
      const t = await tagAll();
      if (t.tagged > 0) {
        reindex();
        console.log(`[tag] +${t.tagged}`);
      }
    }
  } catch (err) {
    console.error(`[scan] ${err.message}`);
  }
}

/**
 * Content-based folder suggestions for sessions the cwd-rule pass couldn't
 * place. Never runs while there's already a queued-but-unreviewed batch —
 * piling up a second round of guesses on top of an unreviewed one would just
 * make the eventual review screen confusing. Default: queue for the human to
 * review (same trust model as w/i and the manual `o` key) — auto-applying is
 * opt-in via config.json's `autoApproveSmartOrganize`.
 */
async function smartOrganizeCycle() {
  if (pendingSuggestions().length) return;
  try {
    await summarizeCandidates({ concurrency: 5 });
    const res = await suggestPlacements({ batchSize: 25, limit: SMART_ORGANIZE_BATCH_LIMIT });
    if (!res.ok) {
      console.error(`[organize] ${res.error}`);
      return;
    }
    const matched = res.placements.filter((p) => p.folder);
    if (!matched.length) return;
    if (loadConfig().autoApproveSmartOrganize) {
      const applied = applyPlacements(res.placements);
      reindex();
      console.log(`[organize] auto-applied ${applied} smart placements`);
    } else {
      const queued = queueSuggestions(res.placements);
      console.log(`[organize] queued ${queued} smart placement suggestions`);
    }
  } catch (err) {
    console.error(`[organize] ${err.message}`);
  }
}

let lastDigestDay = null;
async function digestCycle() {
  const today = new Date().toISOString().slice(0, 10);
  // Once per local day, generate yesterday's digest (the day is complete).
  if (lastDigestDay === today) return;
  lastDigestDay = today;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  try {
    const r = await generateDigest({ period: 'day', date: yesterday });
    if (r.ok) console.log(`[digest] ${r.keyed} (${r.count} sessions)`);
  } catch (err) {
    console.error(`[digest] ${err.message}`);
  }
}

export async function runDaemon() {
  console.log('Mycelium daemon starting (background upkeep: scan + digest + smart organize).');
  console.log(`  scan interval: ${SCAN_INTERVAL_MS}ms`);
  console.log(`  smart organize interval: ${SMART_ORGANIZE_INTERVAL_MS}ms (batch limit ${SMART_ORGANIZE_BATCH_LIMIT})`);

  await scanCycle();
  await digestCycle();
  await smartOrganizeCycle();

  setInterval(scanCycle, SCAN_INTERVAL_MS);
  setInterval(digestCycle, 60 * 60 * 1000); // hourly check; fires once/day
  setInterval(smartOrganizeCycle, SMART_ORGANIZE_INTERVAL_MS);
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Make sure a background daemon is running, spawning a detached one if not —
 * called from the TUI on launch so just opening `mycelium` normally is
 * enough to keep background upkeep alive, no separate `mycelium daemon` /
 * scripts/run.sh step required. Uses the same pidfile scripts/run.sh writes,
 * so `scripts/stop.sh` stops it either way, and running scripts/run.sh
 * separately is still a harmless no-op (same aliveness check).
 */
export function ensureDaemonRunning() {
  if (process.env.MYCELIUM_NO_AUTOSTART) return;
  ensureDirs();
  if (existsSync(DAEMON_PID_PATH)) {
    const pid = Number(readFileSync(DAEMON_PID_PATH, 'utf8').trim());
    if (pid && isAlive(pid)) return; // already running
  }
  const cliPath = fileURLToPath(new URL('./cli.js', import.meta.url));
  const log = openSync(DAEMON_LOG_PATH, 'a');
  const child = spawn(process.execPath, [cliPath, 'daemon'], {
    detached: true,
    stdio: ['ignore', log, log],
  });
  child.unref();
  writeFileSync(DAEMON_PID_PATH, String(child.pid));
}

if (import.meta.url === `file://${process.argv[1]}`) runDaemon();
