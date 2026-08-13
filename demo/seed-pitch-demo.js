#!/usr/bin/env node
// Seeds demo/pitch-data.js's 12 sessions into MYCELIUM_HOME (must already be
// set in the environment — paths.js resolves it once at import time) for
// the flagship pitch video (demo/tapes/pitch-en.tape / pitch-ko.tape).
//
// Deliberately does NOT pre-fill extracted.title/summary the way
// tutorial-data.js's buildMockSessions() does for the interactive
// tutorial — this video wants the real summarize-then-classify pipeline
// (organize.js's summarizeCandidates()/suggestPlacements(), called for
// real against the user's actual claude/codex CLI, no mock provider) to
// run on camera, not skip past it on pre-summarized content.
//
// Usage: MYCELIUM_HOME=/tmp/whatever node demo/seed-pitch-demo.js <en|ko>

import { randomUUID } from 'node:crypto';
import { saveRaw } from '../src/scanner.js';
import { emptyNeutral } from '../src/schema.js';
import { reindex } from '../src/index-db.js';
import { loadConfig, saveConfig } from '../src/config.js';
import { PITCH_SESSIONS } from './pitch-data.js';

const locale = process.argv[2];
if (locale !== 'en' && locale !== 'ko') {
  console.error('Usage: MYCELIUM_HOME=/tmp/whatever node demo/seed-pitch-demo.js <en|ko>');
  process.exit(1);
}

function daysAgo(n, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, Math.floor(Math.random() * 60), 0, 0);
  return d.toISOString();
}

for (const s of PITCH_SESSIONS) {
  const n = emptyNeutral(randomUUID(), s.source);
  n.startedAt = daysAgo(s.daysAgo);
  n.endedAt = daysAgo(s.daysAgo, 11);
  n.turns = s.turns.map((t) => ({ role: t.role, text: t[locale] }));
  saveRaw(n);
}
const total = reindex();

// First-scan onboarding (language/tour picker, welcomeModal) only fires
// when config.onboarded is false — a real returning user's store has it
// true, which is what this video wants to show (drop straight into the
// Sessions cockpit, real sessions.unfiledHint toast and all — 12 sessions
// is under index.js's FIRST_SCAN_MODAL_THRESHOLD of 20, so the toast is
// what actually fires here, not the bigger modal), not a first-run flow.
saveConfig({ ...loadConfig(), onboarded: true, locale });

console.log(`seeded ${PITCH_SESSIONS.length} pitch-demo sessions (${locale}), ${total} total in store`);
