# Short highlight (Organize → Learn → Reuse) for the Software Engineer
# persona — used for README.md's embedded GIF. See demo/README.md for how
# to regenerate and why these settings were chosen.
#
# Markers are anchored on each step's own stable subtitle (or, for the
# handful of titleless "confirm/apply" steps, the real modal content that
# opened right before them) rather than absolute step numbers — the
# tutorial has grown once already (16 → 19 steps, PRs #73/#76) and will
# probably grow again; this way only a genuinely new/reordered step needs
# a new marker, not every tape's numbering. The 3 titleless steps with no
# associated modal at all (intro, the panel-nav step, and the freeform-
# explore step near the end) are the only numbered exceptions — there's no
# stable text to anchor them on. Verified against real tutorial.js
# behavior via a headless createTestApp()/sendKey() dry run before writing
# this, not guessed — see demo/README.md.
#
# Safety: launches `node src/cli.js tui --tutorial` DIRECTLY, not via
# `mycelium demo` — that wrapper re-execs into the REAL ~/.mycelium on a
# completed run, which a recording must never show. This path has no
# parent watching for that handoff, so it's safe by construction even if
# the tape ever runs to the very end. MYCELIUM_HOME below is always a
# disposable /tmp path, never ~/.mycelium or ~/.mycelium-demo.

Output "demo/out/swe-highlight.gif"

Require node
Set Shell "bash"
Set FontSize 15
Set Width 1600
Set Height 900
Set Theme "Dracula"
Set Padding 0
Set TypingSpeed 40ms

Hide
Env MYCELIUM_HOME "/tmp/mycelium-vhs-swe-highlight"
Env MYCELIUM_DEMO_MOCK_DELAY_MS "1200"
Type "node src/cli.js tui --tutorial"
Enter
Show

# Language picker → English
Wait+Screen@6s /Choose your language/
Enter

# Persona picker → Software Engineer (first item)
Wait+Screen@6s /Whose work should the tour follow/
Enter

# Step 1/19 — intro + panel-nav merged: Enter both advances the narrator
# and performs the real "step into Sessions" action (see tutorial.js).
Wait+Screen@6s /Step 1\/19/
Sleep 2s
Enter

# Step 2/19 — action palette intro: press `.`, confirm the real menu
# opened (its own content, not the narrator's own poll-lagged label), then
# close it.
Wait+Screen@6s /Step \d+\/\d+ — Menu/
Sleep 1s
Type "."
Wait+Screen@6s /What do you want to do\?/
Sleep 2s
Escape

# Step 4/19 — Capture: the Sessions view is genuinely empty until this
# exact keypress (mock-session injection is deferred to here, see
# tutorial.js) — arriving here also confirms the palette closed.
Wait+Screen@6s /Step \d+\/\d+ — Capture/
Sleep 1s
Type "s"

# Step 5/19 — Organize (scan's own completion is what this marker's
# appearance confirms — no separate "did scan finish" wait needed).
Wait+Screen@6s /Step \d+\/\d+ — Organize/
Sleep 1s
Type "o"

# Real suggestPlacements() review modal opened.
Wait+Screen@10s /Suggested placements/
Sleep 2s
Enter

# Step 7/19 — back to Folders, then walk down into the now-organized folder
# (Root → New → retail-website → express-reorder, alphabetical — 4 downs).
# No stable subtitle/modal to anchor this arrival on — numbered exception.
Wait+Screen@6s /Step 7\/19/
Sleep 1s
Left
Sleep 500ms
Down
Sleep 300ms
Down
Sleep 300ms
Down
Sleep 300ms
Down
Sleep 500ms
Enter

# Step 8/19 — Learn
Wait+Screen@6s /Step \d+\/\d+ — Learn/
Sleep 1s
Type "w"

# Real knowledge draft ready to save.
Wait+Screen@10s /KNOWLEDGE\.md preview/
Sleep 2s
Enter

# Step 10/19 — Reuse: n → real agent picker → directory picker → auto-copy
# (copyOnly:true during the tutorial — see sessions.js's doNewAgent() — so
# this never risks foregrounding a real agent subprocess). Replaced the
# old read-only `c` context preview with the real mechanism: a genuine
# AGENTS.md gets written to disk. Verified via a headless dry run before
# writing this, not guessed.
Wait+Screen@6s /Step \d+\/\d+ — Reuse/
Sleep 1s
Type "n"

# Real agent picker (launch.selectAgentNew's own title).
Wait+Screen@10s /New task with this folder's context — choose agent/
Sleep 1500ms
Enter

# Real directory picker (launch.selectDir's own title) — the one real,
# disposable suggestion (tutorialProjectDir(), tutorial.js).
Wait+Screen@6s /Choose working directory/
Sleep 1500ms
Enter

# copyOnly's toast shows the real copied command, including the seeded
# prompt (tutorial.newAgentSeed, i18n.js) that makes the next agent report
# its inherited context immediately — worth holding on screen.
Wait+Screen@6s /Command copied to clipboard/
Sleep 3s

# Step 12/19 — closing on a clean, settled list (not mid-modal) so the GIF
# loops smoothly. Highlight ends here — no merge/split/recap. Knowledge
# Review's own subtitle is just a clean landing point, never interacted
# with in this shortened cut.
Wait+Screen@6s /Step \d+\/\d+ — Knowledge Review/
Sleep 2s
