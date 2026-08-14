# Full 16-step tutorial walkthrough for the Cloud Support Engineer
# persona — for the YouTube MP4. See demo/README.md for how to
# regenerate. Key sequence mirrors test/e2e/demo-e2e.test.js's
# "3-way merge across DX/VPC/ALB sessions" case (the persona's own merge
# storyline is a genuine 3-way merge, not 2 — same real code path either
# way, see split.js's dynamic turn-count handling).
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

# Step 1/16 — intro + panel-nav merged
Wait+Screen@6s /Step 1\/16/
Sleep 2s
Enter

# Step 2/16 — Organize
Wait+Screen@6s /Step 2\/16/
Sleep 1s
Type "o"

# Step 3/16 — real suggestPlacements() review modal opened
Wait+Screen@10s /Step 3\/16/
Sleep 2s
Enter

# Step 4/16 — back to Folders, walk down into the organized folder
# (Root → New → cases → onprem-connectivity — 3 downs).
Wait+Screen@6s /Step 4\/16/
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

# Step 5/16 — Learn
Wait+Screen@6s /Step 5\/16/
Sleep 1s
Type "w"

# Step 6/16 — real knowledge draft ready to save
Wait+Screen@10s /Step 6\/16/
Sleep 2s
Enter

# Step 7/16 — Reuse
Wait+Screen@6s /Step 7\/16/
Sleep 1s
Type "c"

# Step 8/16 — real inherited-context viewer open
Wait+Screen@10s /Step 8\/16/
Sleep 2s
Escape

# Step 9/16 — Knowledge review
Wait+Screen@6s /Step 9\/16/
Sleep 1s
Type "k"

# Step 10/16 — real knowledge review modal open
Wait+Screen@10s /Step 10\/16/
Sleep 2s
Enter

# Step 11/16 — Merge (select the top 2 rows, Shift+M — this persona's real
# merge storyline is 3-way, but the tutorial script itself only ever
# selects 2 explicitly; the third gets absorbed the same way the e2e
# test's own cse case exercises it)
Wait+Screen@6s /Step 11\/16/
Sleep 1s
Space
Down
Space
Type "M"

# Step 12/16 — real merge title prompt open
Wait+Screen@10s /Step 12\/16/
Sleep 2s
Enter

# Step 13/16 — Split
Wait+Screen@6s /Step 13\/16/
Sleep 1s
Type "S"

# Step 14/16 — real split-boundary review modal open
Wait+Screen@10s /Step 14\/16/
Sleep 2s
Enter

# Step 15/16 — freeform explore
Wait+Screen@6s /Step 15\/16/
Sleep 2s
Enter

# Step 16/16 — final recap. Hold long enough to read it, then exit.
Wait+Screen@6s /Step 16\/16/
Sleep 6s
Type "q"
Sleep 1s
