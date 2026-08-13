# Flagship ~3-minute pitch video (English) — why Mycelium exists, what it
# is, how to run it, then a live demo against a richer 12-session/4-folder
# dataset than the per-persona tutorial recordings use. See demo/README.md
# for the full rationale (real LLM calls, no tutorial narrator, safety
# design) and how to regenerate.
#
# Real LLM calls: this tape makes genuine calls to your claude/codex CLI —
# organize's summarize+classify phase alone took ~110-150s for 12 sessions
# across several real test renders. Total render still lands comfortably
# under the 3-minute cap without needing any post-processing time-lapse
# (verified: 141-164s end to end across those same renders) — the
# non-LLM segments (intro/how-to/outro banners, navigation) are short
# enough on their own that no artificial speed-up was needed after all.
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
# Modest safety margin against real-LLM timing variance across renders —
# the Korean take came in at 203s on one real run (organize alone can
# range ~110-150s+ for 12 sessions), overshooting the 3-minute cap even
# though this same script's earlier English renders landed at 141-164s.
# 1.25x plus the tighter holds below gives real headroom either way,
# still comfortably watchable (most viewers already play tutorial videos
# at 1.25-1.5x).
Set PlaybackSpeed 1.25

# ── Setup (hidden): seed the richer dataset, alias `mycelium` to the real
# launcher against an isolated store so the rest of this tape can type the
# real, published-package-identical command name.
#
# MYCELIUM_HOME is set via Env — BEFORE the seed script runs, not just for
# the later mycelium() function — so the seed itself lands in the isolated
# /tmp store too. An earlier version of this tape only set it on the
# function definition; the seed command ran with no MYCELIUM_HOME at all
# and silently wrote straight into the real ~/.mycelium (paths.js's own
# default) — caught and cleaned up by hand, not by anything in the tape
# itself. Never repeat that: every command that touches the data layer in
# this tape must run under this same Env, no exceptions. ──
Hide
Env MYCELIUM_HOME "/tmp/mycelium-vhs-pitch-en"
Type "node demo/seed-pitch-demo.js en"
Enter
Sleep 2s
Type "mycelium() { node demo/pitch-launch.js; }"
Enter
Type "clear"
Enter
Show

# ── Why + What ──
Hide
Type "cat demo/banners/intro-en.txt"
Enter
Show
Sleep 10s
Hide
Type "clear"
Enter
Show

# ── How to run ──
Type "npm install -g @kevinprk/mycelium"
Sleep 1500ms
Hide
Type "clear"
Enter
Show
Type "mycelium"
Enter

# ── Live demo ──
Wait+Screen@10s /mycelium/
Sleep 2s

Type "o"
Wait+Screen@180s /Suggested placements/
Sleep 2s
Enter
Sleep 2s

# Back to Folders, walk down into a newly-organized folder
# (Root → New → auth → token-refresh — 3 downs).
Left
Sleep 500ms
Down
Sleep 300ms
Down
Sleep 300ms
Down
Sleep 500ms
Enter
Sleep 1s

Type "w"
Wait+Screen@120s /Project Knowledge/
Sleep 2s
Enter
Sleep 2s

Type "c"
Wait+Screen@10s /Context ·/
Sleep 3s
Escape

# ── Outro ──
# Quit the still-running app FIRST — everything typed after `mycelium`
# launched has been going to the app itself (its own alternate-screen
# fullscreen view), not a shell. An earlier version of this tape skipped
# this and typed `clear`/`cat outro...` straight into the still-running
# app instead of an actual shell prompt — those became random keystrokes
# the app mostly ignored, and the "outro" never appeared in the output at
# all. `q` then `q` again confirms the quit (app.js's confirmQuit()).
Sleep 1s
Type "q"
Sleep 500ms
Type "q"
Sleep 1500ms
Hide
Type "clear"
Enter
Show
Type "cat demo/banners/outro-en.txt"
Enter
Sleep 8s
