import { scan } from '../scanner.js';
import { reindex } from '../index-db.js';
import { summarizeCandidates, suggestPlacements, applyPlacements, queueSuggestions, pendingSuggestions } from '../organize.js';
import { tagAll } from '../learn.js';
import { generateDigest } from '../insight.js';
import { loadConfig } from '../config.js';

// The cadence/policy layer: what runs, how often, and in what order — kept
// separate from process.js's OS-level concerns (spawning/detaching/pidfiles).
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

export async function scanCycle(log) {
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
      // Shares SUMMARIZE_CONCURRENCY with smartOrganizeCycle below — one
      // governing concurrency ceiling for every daemon-triggered batch of
      // LLM calls, not a second independent knob.
      const t = await tagAll({ limit: TAG_BATCH_LIMIT, concurrency: SUMMARIZE_CONCURRENCY });
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
export async function smartOrganizeCycle(log) {
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
export async function digestCycle(log) {
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
 * and by the TUI's own in-process routine (see process.js's startTuiRoutine())
 * — `log` defaults to the real console for the former; the TUI passes a file
 * logger instead, since blessed owns the terminal and raw stdout writes
 * would corrupt the screen.
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
