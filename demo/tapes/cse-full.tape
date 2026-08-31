# Full 20-step tutorial walkthrough for the Cloud Support Engineer
# persona — for the YouTube MP4. See demo/README.md for how to
# regenerate. Key sequence mirrors test/e2e/demo-e2e.test.js's
# "3-way merge across DX/VPC/ALB sessions" case (the persona's own merge
# storyline is a genuine 3-way merge, not 2 — same real code path either
# way, see split.js's dynamic turn-count handling).
#
# Markers are anchored on each step's own stable subtitle (or, for the
# handful of titleless "confirm/apply" steps, the real modal content that
# opened right before them) rather than absolute step numbers, and the
# tutorial is now 20 steps (PR #103 added the retention takeaway right
# after Reuse) — see swe-full.tape's header comment for why.
#
# Safety: see swe-full.tape's header comment — same direct
# `tui --tutorial` invocation, same disposable /tmp MYCELIUM_HOME.

Output "demo/out/cse-full.mp4"

Require node
Set Shell "bash"
Set FontSize 15
Set Width 1600
Set Height 900
Set Theme "Dracula"
Set Padding 0
Set TypingSpeed 40ms

Hide
Env MYCELIUM_HOME "/tmp/mycelium-vhs-cse-full"
Env MYCELIUM_DEMO_MOCK_DELAY_MS "1200"
Type "node src/cli.js tui --tutorial"
Enter
Show

# Language picker → English
Wait+Screen@6s /Choose your language/
Enter

# Persona picker → Cloud Support Engineer (second item)
Wait+Screen@6s /Whose work should the tour follow/
Down
Sleep 300ms
Enter

# Step 1/20 — intro + panel-nav merged
Wait+Screen@6s /Step 1\/20/
Sleep 2s
Enter

# Step 2/20 — action palette intro
Wait+Screen@6s /Step \d+\/\d+ — Menu/
Sleep 1s
Type "."
Wait+Screen@6s /What do you want to do\?/
Sleep 2s
Escape

# Step 4/20 — Capture
Wait+Screen@6s /Step \d+\/\d+ — Capture/
Sleep 1s
Type "s"

# Step 5/20 — Organize
Wait+Screen@6s /Step \d+\/\d+ — Organize/
Sleep 1s
Type "o"

# Real suggestPlacements() review modal opened.
Wait+Screen@10s /Suggested placements/
Sleep 2s
Enter

# Step 7/20 — back to Folders, walk down into the organized folder
# (Root → New → cases → onprem-connectivity — 3 downs). No stable
# subtitle/modal to anchor this arrival on — numbered exception.
Wait+Screen@6s /Step 7\/20/
Sleep 1s
Left
Sleep 500ms
Down
Sleep 300ms
Down
Sleep 300ms
Down
Sleep 500ms
Enter

# Step 8/20 — Learn
Wait+Screen@6s /Step \d+\/\d+ — Learn/
Sleep 1s
Type "w"

# Real knowledge draft ready to save.
Wait+Screen@10s /KNOWLEDGE\.md preview/
Sleep 2s
Enter

# Step 10/20 — Reuse: n → real agent picker → directory picker → auto-copy
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

# Step 12/20 — the retention takeaway (PR #103): why the snapshot n just
# wrote actually matters (Claude Code prunes old sessions, Codex/Kiro
# don't, n/h keep working regardless). Titleless, no modal of its own —
# numbered exception, same as the panel-nav step above.
Wait+Screen@6s /Step 12\/20/
Sleep 4s
Enter

# Step 13/20 — Knowledge review
Wait+Screen@6s /Step \d+\/\d+ — Knowledge Review/
Sleep 1s
Type "k"

# Real knowledge review modal open.
Wait+Screen@10s /Review knowledge updates/
Sleep 2s
Enter

# Step 15/20 — Merge (select the top 2 rows, Shift+M — this persona's real
# merge storyline is 3-way, but the tutorial script itself only ever
# selects 2 explicitly; the third gets absorbed the same way the e2e
# test's own cse case exercises it)
Wait+Screen@6s /Step \d+\/\d+ — Merge/
Sleep 1s
Space
Down
Space
Type "M"

# Real merge title prompt open.
Wait+Screen@10s /Title for the merged session/
Sleep 2s
Enter

# Step 17/20 — Split
Wait+Screen@6s /Step \d+\/\d+ — Split/
Sleep 1s
Type "S"

# Real split-boundary review modal open.
Wait+Screen@10s /Proposed split/
Sleep 2s
Enter

# Step 19/20 — freeform explore. No stable subtitle/modal to anchor this
# arrival on — numbered exception.
Wait+Screen@6s /Step 19\/20/
Sleep 2s
Enter

# Step 20/20 — final recap. Hold long enough to read it, then exit.
Wait+Screen@6s /Step \d+\/\d+ — Complete!/
Sleep 6s
Type "q"
Sleep 1s
