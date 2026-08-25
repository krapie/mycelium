import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ensureDirs, CONFIG_PATH } from './paths.js';

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

// Which language LLM-generated content should come out in — learn.js/
// organize/classify.js/insight.js/split.js all read this instead of
// hardcoding one language. Same fallback rule as i18n.js's getLocale().
export function contentLocale() {
  return loadConfig().locale === 'ko' ? 'ko' : 'en';
}
