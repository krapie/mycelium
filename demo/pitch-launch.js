#!/usr/bin/env node
// Real sessionsView(), no tutorial narrator, no background daemon.
//
// This is index.js's own runTui() tail (mount sessionsView, notifyPostMount)
// with ONE thing removed: the unconditional startTuiRoutine() call every
// normal launch makes. That call immediately runs a real scanCycle(), and
// adapters always read the ACTUAL ~/.claude/~/.codex/~/.kiro history
// regardless of MYCELIUM_HOME (AGENTS.md: "Adapters intentionally read
// from the real ~/.claude/~/.codex/~/.kiro... not MYCELIUM_HOME") — so a
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
// Usage: MYCELIUM_HOME=/tmp/whatever node demo/pitch-launch.js

import { createApp } from '../src/tui/app.js';
import { sessionsView } from '../src/tui/views/sessions.js';
import { notifyPostMount } from '../src/tui/index.js';

const app = createApp();
await app.show(sessionsView());
app.render();
notifyPostMount(app);
