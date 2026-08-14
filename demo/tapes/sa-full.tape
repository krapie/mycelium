# Full 16-step tutorial walkthrough for the Solutions Architect persona —
# for the YouTube MP4. See demo/README.md for how to regenerate, and
# sa-highlight.tape's header comment for where the down-navigation depth
# came from (no existing e2e coverage for this persona — confirmed with a
# throwaway interactive dry-run, not guessed).
#
# Safety: see swe-full.tape's header comment — same direct
# `tui --tutorial` invocation, same disposable /tmp MYCELIUM_HOME.

Output "demo/out/sa-full.mp4"

Require node
Set Shell "bash"
Set FontSize 15
Set Width 1600
Set Height 900
Set Theme "Dracula"
Set Padding 0
Set TypingSpeed 40ms

Hide
Env MYCELIUM_HOME "/tmp/mycelium-vhs-sa-full"
Env MYCELIUM_DEMO_MOCK_DELAY_MS "1200"
Type "node src/cli.js tui --tutorial"
Enter
Show

# Language picker → English
Wait+Screen@6s /Choose your language/
Enter

# Persona picker → Solutions Architect (third item)
Wait+Screen@6s /Whose work should the tour follow/
Down
Sleep 300ms
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
# (Root → New → customers → nimbustech — 4 downs).
Wait+Screen@6s /Step 4\/16/
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

# Step 11/16 — Merge (select the top 2 rows, Shift+M)
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
