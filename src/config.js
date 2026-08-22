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
  // First-time capture of a session whose last activity is older than this
  // (days) files it straight into _archive instead of the New/unfiled
  // backlog — so a heavy first scan of thousands of historical sessions
  // doesn't present as thousands of things to triage. Capture stays lossless
  // (they're still stored + searchable); this only changes where a *newly
  // discovered* old session lands. <= 0 disables (capture everything as New).
  // See scanner.js's scan() (assigns on capture) and reevaluateArchive()
  // (re-applies this threshold to the existing auto-archived backlog when the
  // value changes — `mycelium archive reeval`).
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

// Which language LLM-generated content (auto-tag titles/summaries,
// classification reasons, digests, KNOWLEDGE.md) should come out in —
// learn.js/organize/classify.js/insight.js/split.js all read this instead
// of hardcoding one language, so a locale switch (`mycelium lang ko`, the
// TUI's own `l` key) affects generated CONTENT the same way it already
// affects UI chrome (src/tui/i18n.js's t()), not just the screen around it.
// Same fallback rule as i18n.js's own getLocale(): 'en' for anything that
// isn't explicitly 'ko'.
export function contentLocale() {
  return loadConfig().locale === 'ko' ? 'ko' : 'en';
}
