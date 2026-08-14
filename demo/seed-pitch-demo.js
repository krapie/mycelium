#!/usr/bin/env node
// Seeds demo/pitch-data.js's 12 sessions (4 storylines x 3 sessions) into
// MYCELIUM_HOME (must already be set in the environment — paths.js resolves
// it once at import time) for the flagship pitch video
// (demo/tapes/pitch-en.tape / pitch-ko.tape).
//
// Pre-fills extracted.title/summary/tags — the same shortcut
// src/tui/tutorial-data.js's buildMockSessions() takes for the interactive
// tutorial — so organize/classify.js's summarizeCandidates() (filters on
// `!n.extracted.summary`) finds nothing left to summarize and the `o` press
// goes straight to classification. This video now runs entirely against the
// mocked provider demo/pitch-launch.js installs (see that file), not real
// claude/codex calls — an earlier version of this file deliberately left
// extracted blank so a real LLM would summarize on camera, but that made
// organize alone take 110-150s+ per render. See demo/README.md's "pitch
// video" section for the full rationale.
//
// Usage: MYCELIUM_HOME=/tmp/whatever node demo/seed-pitch-demo.js <en|ko>

import { randomUUID } from 'node:crypto';
import { readdirSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { saveRaw } from '../src/scanner.js';
import { emptyNeutral } from '../src/schema.js';
import { reindex } from '../src/index-db.js';
import { loadConfig, saveConfig } from '../src/config.js';
import { RAW_DIR, TREE_DIR, DIGEST_DIR, ensureDirs } from '../src/paths.js';
import { writePendingKnowledgeText } from '../src/insight.js';
import { PITCH_STORYLINES, PITCH_MERGE_STORYLINE_INDEX } from './pitch-data.js';

const locale = process.argv[2];
if (locale !== 'en' && locale !== 'ko') {
  console.error('Usage: MYCELIUM_HOME=/tmp/whatever node demo/seed-pitch-demo.js <en|ko>');
  process.exit(1);
}

// Idempotent, not additive: each session gets a fresh randomUUID() (no
// stable id to overwrite by), so re-running this against a MYCELIUM_HOME
// that already has a prior run's data would otherwise just pile up more
// sessions on top (found by hand — a second render reused the same /tmp
// path and ended up with 24 sessions instead of 12). Clearing RAW_DIR
// alone isn't enough either — TREE_DIR (real folder directories, created
// by a previous run's applyPlacements()) survives that and left stale
// EMPTY folders (e.g. a leftover "ci" with 0 sessions) sitting alongside
// this run's real ones; a tape's alphabetical down-navigation landed on
// one of those by chance and pressing `w` found nothing to summarize,
// timing out waiting for a real KNOWLEDGE.md draft that was never going to
// come. DIGEST_DIR cleared too for the same "fully reset, not merged with
// a prior run" reasoning, though nothing in this tape generates a digest.
// Safe here because this only ever runs against a disposable /tmp path a
// tape's Env command set up moments earlier, never ~/.mycelium.
ensureDirs();
for (const dir of [RAW_DIR, TREE_DIR, DIGEST_DIR]) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) rmSync(join(dir, f), { recursive: true });
}

function daysAgo(n, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, Math.floor(Math.random() * 60), 0, 0);
  return d.toISOString();
}

// Real, existing (but fake) project directories, one per top-level folder —
// so reuse.js's dirsForFolder() (backing launch.js's `n`/`h` directory
// picker) finds a real directory automatically instead of falling back to a
// typed-path prompt, and so injectAgentsMd() has somewhere real to write
// AGENTS.md when the tape presses `h`. Derived from MYCELIUM_HOME rather
// than a separate Env line, so the tape doesn't need to know about this.
// Cleared and recreated every run, same idempotent-seeding reasoning as
// RAW_DIR/TREE_DIR/DIGEST_DIR above — a stale AGENTS.md from a prior run
// would otherwise make the `h` demo's "cat the injected file" beat show
// leftover content instead of a clean write.
const reposDir = `${process.env.MYCELIUM_HOME}-repos`;
if (existsSync(reposDir)) rmSync(reposDir, { recursive: true });
function repoDirFor(folder) {
  const dir = join(reposDir, folder.replace(/\//g, '-'));
  mkdirSync(dir, { recursive: true });
  return dir;
}

for (const storyline of PITCH_STORYLINES) {
  const dir = repoDirFor(storyline.folder);
  for (const s of storyline.sessions) {
    const n = emptyNeutral(randomUUID(), s.source);
    n.startedAt = daysAgo(s.daysAgo);
    n.endedAt = daysAgo(s.daysAgo, 11);
    n.turns = s.turns.map((t) => ({ role: t.role, text: t[locale] }));
    n.extracted.title = s.title[locale];
    n.extracted.summary = s.summary[locale];
    n.extracted.tags = s.tags;
    n.summarizedTurnCount = n.turns.length;
    n.cwd = dir;
    n.projectDir = dir;
    saveRaw(n);
  }
}
const total = reindex();

// Pre-stage a knowledge-refresh proposal for the merge-target folder, as if
// the daemon's independent knowledgeReviewCycle had already computed it
// overnight — same trick src/tui/tutorial.js's seedMockSessions() uses so
// the tape's `k` (knowledge review) press hits the fast "reuse whatever's
// queued" path instantly instead of proposeKnowledgeRefreshes()'s fresh-
// compute path, which only picks up folders with a session that actually
// STARTED today (src/insight.js's foldersActiveOn()) — none of this video's
// sessions are dated today (they're all `daysAgo`-relative, for a realistic
// "been working on this for a while" feel), so without this the `k` step
// would silently find nothing to review.
const mergeFolder = PITCH_STORYLINES[PITCH_MERGE_STORYLINE_INDEX].folder;
const mergeKnowledge = PITCH_STORYLINES[PITCH_MERGE_STORYLINE_INDEX].knowledge[locale];
writePendingKnowledgeText(mergeFolder, mergeKnowledge);

// First-scan onboarding (language/tour picker, welcomeModal) only fires
// when config.onboarded is false — a real returning user's store has it
// true, which is what this video wants to show (drop straight into the
// Sessions cockpit, real sessions.unfiledHint toast and all — 12 sessions
// is under index.js's FIRST_SCAN_MODAL_THRESHOLD of 20, so the toast is
// what actually fires here, not the bigger modal), not a first-run flow.
saveConfig({ ...loadConfig(), onboarded: true, locale });

const seededCount = PITCH_STORYLINES.reduce((sum, s) => sum + s.sessions.length, 0);
console.log(`seeded ${seededCount} pitch-demo sessions (${locale}), ${total} total in store`);
