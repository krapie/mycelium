import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { ensureDirs, CONFIG_PATH, EXCLUDED_PATH } from './paths.js';

// Shared config.json read/write. Lives outside organize.js and scanner.js so
// both can depend on it without a circular import (scanner.js needs it to
// skip deleted sessions on rescan; organize.js needs it for recording
// deletions).
const DEFAULTS = {
  excludedSessionIds: [],
  locale: 'en',
  autoApproveSmartOrganize: false,
  onboarded: false,
  // First-time capture of a session older than this (days) files it
  // straight into _archive instead of New — capture stays lossless, this
  // only changes where a newly discovered old session lands. <=0 disables.
  // See scanner.js's scan()/reevaluateArchive().
  archiveOlderThanDays: 90,
  // Set once index.js's notifyPostMount() has shown the large-backlog
  // first-scan modal (see widgets/viewers.js's firstScanModal()) — that
  // modal is a one-time nudge, not a recurring one, unlike the lightweight
  // toast it replaces for big backlogs.
  firstScanModalShown: false,
};

export function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(cfg) {
  ensureDirs();
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

/**
 * This machine's name, stamped on every session it captures or creates
 * (saveRaw()'s `host`) so a synced store can tell which machine a session's
 * agent transcript actually lives on. Derived from the hostname once and then
 * persisted: macOS hostnames change with the network (`foo.local` vs a
 * DHCP-assigned name), and a name that drifts would make this machine's own
 * sessions look foreign to it.
 */
export function machineName() {
  const cfg = loadConfig();
  if (cfg.machineName) return cfg.machineName;
  const name = hostname().split('.')[0] || 'machine';
  saveConfig({ ...cfg, machineName: name });
  return name;
}

/**
 * Ids of sessions the user deleted — scan() must never re-import them even
 * though the agent's own log is still on disk. Kept in excluded.txt, not
 * config.json, because a deletion has to reach every synced machine: deleting
 * on one machine a session that was captured on another would otherwise come
 * straight back at that machine's next scan. Older stores kept the list in
 * config.json; it moves over the first time it's read.
 */
export function excludedIds() {
  const ids = new Set();
  if (existsSync(EXCLUDED_PATH)) {
    for (const line of readFileSync(EXCLUDED_PATH, 'utf8').split('\n')) {
      if (line.trim()) ids.add(line.trim());
    }
  }
  const cfg = loadConfig();
  if (cfg.excludedSessionIds?.length) {
    for (const id of cfg.excludedSessionIds) ids.add(id);
    writeExcluded(ids);
    saveConfig({ ...cfg, excludedSessionIds: [] });
  }
  return ids;
}

export function addExcludedId(id) {
  const ids = excludedIds();
  if (ids.has(id)) return;
  ids.add(id);
  writeExcluded(ids);
}

// Sorted, one id per line: sync merges this file with git's built-in `union`
// driver, which only works cleanly on line-oriented text.
function writeExcluded(ids) {
  ensureDirs();
  writeFileSync(EXCLUDED_PATH, [...ids].sort().join('\n') + '\n');
}

// Which language LLM-generated content should come out in — learn.js/
// organize/classify.js/insight.js/split.js all read this instead of
// hardcoding one language. Same fallback rule as i18n.js's getLocale().
export function contentLocale() {
  return loadConfig().locale === 'ko' ? 'ko' : 'en';
}

// How many sessions one organize run (TUI `o`, `mycelium organize`) may
// process — summarize, classify, and queued suggestions alike — so a large
// backlog is worked through in batches instead of one quota-draining run
// (#167). Set with `mycelium organize --set-limit N`; until then
// MYCELIUM_SUMMARIZE_BATCH_LIMIT (the TUI's older knob) or 30.
export const DEFAULT_ORGANIZE_LIMIT = 30;

export function parseLimit(value) {
  // A bare `--limit` flag parses as `true`, and Number(true) is 1.
  if (typeof value === 'boolean' || value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function organizeLimit() {
  return (
    parseLimit(loadConfig().organizeLimit) ?? parseLimit(process.env.MYCELIUM_SUMMARIZE_BATCH_LIMIT) ?? DEFAULT_ORGANIZE_LIMIT
  );
}
