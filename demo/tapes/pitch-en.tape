# Flagship ~3-minute pitch video (English) — why Mycelium exists, what it
# is, how to run it, then a live demo of the FULL lifecycle (organize,
# learn, reuse, knowledge review, merge, split) against a richer 12-session/
# 4-folder dataset than the per-persona tutorial recordings use. See
# demo/README.md for the full rationale and how to regenerate.
#
# Mocked, not real LLM calls: an earlier version of this tape used the real
# claude/codex CLI — organize alone (12 sessions) took 110-150s+ per render,
# most of a 3-minute video spent watching a progress bar, and made showing
# more than organize+learn+reuse impractical. This version runs entirely
# against demo/pitch-data.js's own mocked provider (same __setTestProvider()
# seam the persona tutorial uses — see demo/pitch-launch.js), which is what
# makes showing the FULL lifecycle in under 3 minutes possible at all. Every
# key sequence below (organize -> navigate -> learn -> context -> knowledge
# review -> merge -> split) was verified against real resulting state (not
# just visually) via a one-off headless dry run using test/tui-helpers.js's
# own createTestApp()/sendKey() harness before this tape was written — same
# method test/e2e/demo-e2e.test.js uses, not guessed.
#
# Safety: mounts sessionsView() directly via demo/pitch-launch.js, which
# deliberately skips runTui()'s startTuiRoutine() call — that call runs a
# real scanCycle() on startup, and adapters always read the ACTUAL
# ~/.claude/~/.codex/~/.kiro history regardless of MYCELIUM_HOME (confirmed
# live: a normal launch surfaced real personal session titles within
# seconds even against a disposable MYCELIUM_HOME). See pitch-launch.js's
# own header comment for the full explanation. MYCELIUM_HOME below is
# always a disposable /tmp path.

Output "demo/out/pitch-en.mp4"

Require node
Set Shell "bash"
Set FontSize 15
Set Width 1600
Set Height 900
Set Theme "Dracula"
Set Padding 0
Set TypingSpeed 40ms

# ── Setup (hidden): seed the richer dataset, alias `mycelium` to the real
# launcher against an isolated store so the rest of this tape can type the
# real, published-package-identical command name.
#
# MYCELIUM_HOME is set via Env — BEFORE the seed script runs, not just for
# the later mycelium() function — so the seed itself lands in the isolated
# /tmp store too. Every command that touches the data layer in this tape
# must run under this same Env, no exceptions — an earlier version of this
# tape got this wrong once and silently wrote into the real ~/.mycelium; see
# demo/README.md's "pitch video" section for the full incident writeup.
#
# MYCELIUM_DEMO_MOCK_DELAY_MS matches the persona tapes' own value — long
# enough for the spinner to visibly animate a few frames, short enough that
# 12 sessions' worth of mocked calls still finish in a couple of seconds. ──
Hide
Env MYCELIUM_HOME "/tmp/mycelium-vhs-pitch-en"
Env MYCELIUM_DEMO_MOCK_DELAY_MS "1200"
Type "node demo/seed-pitch-demo.js en"
Enter
Sleep 1s
Type "mycelium() { node demo/pitch-launch.js en; }"
Enter
Type "clear"
Enter
Show

# ── Why + What ──
Hide
Type "cat demo/banners/intro-en.txt"
Enter
Show
Sleep 12s
Hide
Type "clear"
Enter
Show

# ── How to run ── (typed, deliberately never Entered — showing the install
# command without actually running a real global install during recording)
Type "npm install -g @kevinprk/mycelium"
Sleep 2s
Hide
# Ctrl+C cancels the still-unsent line above before clearing — without it,
# the next "clear" keystrokes append to that same unsent buffer instead of
# starting fresh (harmless since it's inside Hide, but worth doing right).
Ctrl+C
Type "clear"
Enter
Show
Type "mycelium"
Enter

# ── Live demo: the full lifecycle ──
# Pacing note: every hold below is sized to actually READ the screen's
# content (a 12-item list, a KNOWLEDGE.md draft, a review modal), not just
# to satisfy the Wait marker — mocked calls resolve in ~1-2s regardless, so
# the deliberate Sleep after each Wait is what gives a human time to read
# before the next key fires. See demo/README.md's "pitch video" section for
# the full pacing rationale (target ~100-120s total, well under the 180s cap).
Wait+Screen@10s /mycelium/
Sleep 2s

# Organize — o classifies all 12 unfiled sessions into 4 folders (mocked,
# deterministic — see demo/pitch-data.js's keywords per storyline). Long
# hold before applying — this list is the first real content on screen.
Type "o"
Wait+Screen@15s /Suggested placements/
Sleep 6s
Enter
Sleep 3s

# Back to Folders, walk down into auth/token-refresh specifically — 3 downs
# from Root (Root, New, auth, auth/token-refresh, alphabetical), confirmed
# via the dry run referenced above, not guessed.
Left
Sleep 600ms
Down
Sleep 600ms
Down
Sleep 600ms
Down
Sleep 1s
Enter
Sleep 1500ms

# Learn — w extracts this folder's KNOWLEDGE.md.
Type "w"
Wait+Screen@10s /Project Knowledge/
Sleep 6s
Enter
Sleep 2500ms

# Reuse — c shows the context this folder would hand to the next session.
Type "c"
Wait+Screen@10s /Context ·/
Sleep 6s
Escape
Sleep 1500ms

# Knowledge review — k reviews/approves knowledge updates across every
# active folder at once (a pending proposal was pre-staged at seed time,
# same trick the interactive tutorial uses — see seed-pitch-demo.js).
Type "k"
Wait+Screen@10s /Review knowledge updates/
Sleep 5s
Enter
Sleep 2s

# Merge — select the first 2 sessions in this folder (proactive refresh +
# retry/backoff), Shift+M. Brief pauses between selection keys so each
# checkmark is visible landing, not just the end state.
Space
Sleep 400ms
Down
Sleep 400ms
Space
Sleep 400ms
Type "M"
Wait+Screen@10s /Title for the merged session/
Sleep 5s
Enter
Sleep 4s

# Split the merged product back into its 2 halves. 5 Ups guarantees landing
# on the merged row regardless of where focus was left — its startedAt
# deliberately sorts ahead of the one untouched session in this folder (see
# pitch-data.js's comment on that session's daysAgo), so Up-to-top is
# reliable rather than guessed.
Up
Up
Up
Up
Up
Type "S"
Wait+Screen@10s /Proposed split/
Sleep 5s
Enter
Sleep 4s

# ── Outro (quit first — the app runs fullscreen; anything typed before
# quitting goes to the app itself, not a shell) ──
Sleep 800ms
Type "q"
Sleep 800ms
Type "q"
Sleep 2s
Hide
Type "clear"
Enter
Show
Type "cat demo/banners/outro-en.txt"
Enter
Sleep 13s
