import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync, openSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scan } from './scanner.js';
import { reindex } from './index-db.js';
import { summarizeCandidates, suggestPlacements, applyPlacements, queueSuggestions, pendingSuggestions } from './organize.js';
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
// A session the LLM couldn't confidently place stays unresolved — without a
// cooldown it would get re-sent to the LLM every single cycle forever (real
// cost, no resolution). See organize.js's classificationCandidates().
const SMART_ORGANIZE_COOLDOWN_MS = Number(process.env.MYCELIUM_SMART_ORGANIZE_COOLDOWN_MS || 24 * 60 * 60 * 1000);
// Same "gradual drain" reasoning as SMART_ORGANIZE_BATCH_LIMIT, applied to
// tagAll()'s auto-summarize pass — a big backlog (e.g. the very first scan)
// no longer gets attempted all in one scanCycle() call.
const TAG_BATCH_LIMIT = Number(process.env.MYCELIUM_TAG_BATCH_LIMIT || 20);
// How many `claude`/`codex` subprocesses summarizeCandidates() runs at once
// during the unattended smart-organize cycle. Kept low by default — see
// issue #3 (looked like runaway Claude console windows on Windows; the real
// cause was many of these piling up concurrently).
const SUMMARIZE_CONCURRENCY = Number(process.env.MYCELIUM_SUMMARIZE_CONCURRENCY || 3);

// setInterval doesn't wait for a previous async callback to finish before
// scheduling the next one — on a large backlog, a single scanCycle()/
// smartOrganizeCycle() call can easily outlast its own interval, and
// without these guards the next tick starts a second, overlapping run on
// top of it. Left unchecked over time this is exactly how issue #3's 20+
// concurrent `claude -p` processes piled up. Each cycle just skips its own
// tick (logged) if the previous one is still in flight.
let scanRunning = false;
let organizeRunning = false;

async function scanCycle(log) {
  if (scanRunning) return log.log('[scan] skip — previous cycle still running');
  scanRunning = true;
  try {
    const res = scan();
    if (res.imported > 0) {
      // Captured sessions stay unfiled (Root) until smart-organize (below),
      // a manual move, or a launch into a folder deliberately places them.
      // Just reindex + tag.
      reindex();
      log.log(`[scan] +${res.imported} (reindexed)`);
      // Tag freshly imported sessions (skips those already summarized).
      const t = await tagAll({ limit: TAG_BATCH_LIMIT });
      if (t.tagged > 0) {
        reindex();
        log.log(`[tag] +${t.tagged}`);
      }
    }
  } catch (err) {
    log.error(`[scan] ${err.message}`);
  } finally {
    scanRunning = false;
  }
}

/**
 * Content-based folder suggestions for whatever still needs one. Never runs
 * while there's already a queued-but-unreviewed batch — piling up a second
 * round of guesses on top of an unreviewed one would just make the eventual
 * review screen confusing. Default: queue for the human to review (same
 * trust model as w/i and the manual `o` key) — auto-applying is opt-in via
 * config.json's `autoApproveSmartOrganize`.
 */
async function smartOrganizeCycle(log) {
  if (pendingSuggestions().length) return;
  if (organizeRunning) return log.log('[organize] skip — previous cycle still running');
  organizeRunning = true;
  try {
    await summarizeCandidates({ concurrency: SUMMARIZE_CONCURRENCY });
    const res = await suggestPlacements({
      batchSize: 25,
      limit: SMART_ORGANIZE_BATCH_LIMIT,
      cooldownMs: SMART_ORGANIZE_COOLDOWN_MS,
    });
    if (!res.ok) {
      log.error(`[organize] ${res.error}`);
      return;
    }
    const matched = res.placements.filter((p) => p.folder);
    if (!matched.length) return;
    if (loadConfig().autoApproveSmartOrganize) {
      const applied = applyPlacements(res.placements);
      reindex();
      log.log(`[organize] auto-applied ${applied} smart placements`);
    } else {
      const queued = queueSuggestions(res.placements);
      log.log(`[organize] queued ${queued} smart placement suggestions`);
    }
  } catch (err) {
    log.error(`[organize] ${err.message}`);
  } finally {
    organizeRunning = false;
  }
}

let lastDigestDay = null;
async function digestCycle(log) {
  const today = new Date().toISOString().slice(0, 10);
  // Once per local day, generate yesterday's digest (the day is complete).
  if (lastDigestDay === today) return;
  lastDigestDay = today;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  try {
    const r = await generateDigest({ period: 'day', date: yesterday });
    if (r.ok) log.log(`[digest] ${r.keyed} (${r.count} sessions)`);
  } catch (err) {
    log.error(`[digest] ${err.message}`);
  }
}

/**
 * The actual upkeep loop (scan → organize → tag, smart-organize, digest) on
 * its three cadences. Used both by the standalone `mycelium daemon` process
 * and by the TUI's own in-process routine (see startTuiRoutine()) — `log`
 * defaults to the real console for the former; the TUI passes a file logger
 * instead, since blessed owns the terminal and raw stdout writes would
 * corrupt the screen.
 */
export async function runDaemon({ log = console } = {}) {
  log.log('Mycelium daemon starting (background upkeep: scan + digest + smart organize).');
  log.log(`  scan interval: ${SCAN_INTERVAL_MS}ms (tag batch limit ${TAG_BATCH_LIMIT})`);
  log.log(
    `  smart organize interval: ${SMART_ORGANIZE_INTERVAL_MS}ms (batch limit ${SMART_ORGANIZE_BATCH_LIMIT}, cooldown ${SMART_ORGANIZE_COOLDOWN_MS}ms, concurrency ${SUMMARIZE_CONCURRENCY})`,
  );

  await scanCycle(log);
  await digestCycle(log);
  await smartOrganizeCycle(log);

  setInterval(() => scanCycle(log), SCAN_INTERVAL_MS);
  setInterval(() => digestCycle(log), 60 * 60 * 1000); // hourly check; fires once/day
  setInterval(() => smartOrganizeCycle(log), SMART_ORGANIZE_INTERVAL_MS);
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
 * Run the upkeep loop inside the TUI's own process instead of a separate
 * detached one — called once from the TUI on launch. This replaced an
 * earlier design that auto-spawned a long-lived detached `mycelium daemon`
 * process on every TUI launch: that process kept running old in-memory code
 * across TUI restarts, so code changes silently stopped taking effect until
 * someone remembered to `mycelium daemon --stop` it (a real bug hit once).
 * Running in-process means every `mycelium` launch always runs the current
 * code, and upkeep naturally stops when the TUI exits — no separate process
 * to leak or go stale. Output goes to DAEMON_LOG_PATH, not stdout — blessed
 * owns the terminal, so raw console writes would corrupt the screen.
 * Opt-out via MYCELIUM_NO_AUTOSTART (used by automated TUI smoke tests to
 * avoid triggering real LLM calls in the background).
 */
export function startTuiRoutine() {
  if (process.env.MYCELIUM_NO_AUTOSTART) return;
  ensureDirs();
  const fileLog = {
    log: (...args) => appendFileSync(DAEMON_LOG_PATH, `[${new Date().toISOString()}] ${args.join(' ')}\n`),
    error: (...args) => appendFileSync(DAEMON_LOG_PATH, `[${new Date().toISOString()}] ${args.join(' ')}\n`),
  };
  runDaemon({ log: fileLog });
}

/**
 * Spawn a detached daemon if one isn't already running (pidfile-based,
 * idempotent) — for anyone who explicitly wants background upkeep to keep
 * running even while the TUI itself is closed (`mycelium daemon --detach`,
 * or scripts/run.sh). Not used by the TUI itself anymore — see
 * startTuiRoutine() above. Same pidfile `scripts/run.sh`/`stop.sh` use, so
 * `mycelium daemon --stop` / `scripts/stop.sh` both work on whichever one
 * started it.
 */
export function spawnDetachedDaemon() {
  ensureDirs();
  if (existsSync(DAEMON_PID_PATH)) {
    const pid = Number(readFileSync(DAEMON_PID_PATH, 'utf8').trim());
    if (pid && isAlive(pid)) return { started: false, pid };
  }
  const cliPath = fileURLToPath(new URL('./cli.js', import.meta.url));
  const log = openSync(DAEMON_LOG_PATH, 'a');
  const child = spawn(process.execPath, [cliPath, 'daemon'], {
    detached: true,
    stdio: ['ignore', log, log],
  });
  child.unref();
  writeFileSync(DAEMON_PID_PATH, String(child.pid));
  return { started: true, pid: child.pid };
}

/** Stop a daemon started via spawnDetachedDaemon()/scripts/run.sh, if running. */
export function stopDetachedDaemon() {
  if (!existsSync(DAEMON_PID_PATH)) return { stopped: false, reason: 'not running' };
  const pid = Number(readFileSync(DAEMON_PID_PATH, 'utf8').trim());
  const stopped = pid && isAlive(pid);
  if (stopped) process.kill(pid);
  rmSync(DAEMON_PID_PATH, { force: true });
  return { stopped, pid };
}

if (import.meta.url === `file://${process.argv[1]}`) runDaemon();
