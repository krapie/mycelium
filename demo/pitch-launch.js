#!/usr/bin/env node
// Real sessionsView(), no tutorial narrator, no background daemon, no real
// LLM calls — every classify/learn/knowledge/split call in this process
// resolves against demo/pitch-data.js's mocked, deterministic provider
// instead of a real claude/codex subprocess (see __setTestProvider() below).
// An earlier version of this video used real LLM calls; organize alone took
// 110-150s+ per render, which made the video both slow and too cramped to
// show more than organize+learn+reuse. See demo/README.md's "pitch video"
// section for the full rationale.
//
// This is index.js's own runTui() tail (mount sessionsView, notifyPostMount)
// with ONE thing removed: the unconditional startTuiRoutine() call every
// normal launch makes. That call immediately runs a real scanCycle(), and
// adapters always read the ACTUAL ~/.claude/~/.codex/~/.kiro/opencode.db
// history regardless of MYCELIUM_HOME (AGENTS.md: "Adapters intentionally
// read from the real ~/.claude/~/.codex/~/.kiro/opencode.db... not
// MYCELIUM_HOME") — so a
// normal launch against even a disposable MYCELIUM_HOME would still pull
// in and display the presenter's real personal sessions within seconds.
// Confirmed live: launching plain `node src/cli.js` against a freshly
// seeded isolated store surfaced real session titles from this machine's
// actual Claude Code history almost immediately.
//
// The flagship pitch video (demo/tapes/pitch-en.tape / pitch-ko.tape) must
// show ONLY demo/pitch-data.js's seeded content — sessionsView() itself
// never calls scan() on mount (only the `s` key does, which this tape
// never presses), so skipping startTuiRoutine() here is sufficient.
//
// Usage: MYCELIUM_HOME=/tmp/whatever node demo/pitch-launch.js <en|ko>

import { createApp } from '../src/tui/app.js';
import { sessionsView } from '../src/tui/views/sessions.js';
import { notifyPostMount } from '../src/tui/index.js';
import { __setTestProvider } from '../src/llm.js';
import { createMockProvider, resolveStorylines } from '../src/tui/tutorial-mock-llm.js';
import { PITCH_STORYLINES, PITCH_MERGE_STORYLINE_INDEX } from './pitch-data.js';

const locale = process.argv[2];
if (locale !== 'en' && locale !== 'ko') {
  console.error('Usage: MYCELIUM_HOME=/tmp/whatever node demo/pitch-launch.js <en|ko>');
  process.exit(1);
}

// Must happen in THIS process, before any key handler can call complete() —
// __setTestProvider() (src/llm.js) is a module-level seam scoped to one
// process, so setting it from the separate seed-pitch-demo.js script
// (already-exited by the time this runs) would do nothing.
const storylines = resolveStorylines(PITCH_STORYLINES, locale);
const mergeStoryline = storylines[PITCH_MERGE_STORYLINE_INDEX];
__setTestProvider(createMockProvider(storylines, mergeStoryline, locale));

const app = createApp();
await app.show(sessionsView());
app.render();
notifyPostMount(app);
