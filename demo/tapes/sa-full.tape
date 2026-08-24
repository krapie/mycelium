# Full 19-step tutorial walkthrough for the Solutions Architect persona —
# for the YouTube MP4. See demo/README.md for how to regenerate, and
# sa-highlight.tape's header comment for where the down-navigation depth
# came from (no existing e2e coverage for this persona — confirmed with a
# throwaway interactive dry-run, not guessed).
#
# Markers are anchored on each step's own stable subtitle (or, for the
# handful of titleless "confirm/apply" steps, the real modal content that
# opened right before them) rather than absolute step numbers — see
# swe-full.tape's header comment for why.
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

# Step 1/19 — intro + panel-nav merged
Wait+Screen@6s /Step 1\/19/
Sleep 2s
Enter

# Step 2/19 — action palette intro
Wait+Screen@6s /Step \d+\/\d+ — Menu/
Sleep 1s
Type "."
Wait+Screen@6s /What do you want to do\?/
Sleep 2s
Escape

# Step 4/19 — Capture
Wait+Screen@6s /Step \d+\/\d+ — Capture/
Sleep 1s
Type "s"

# Step 5/19 — Organize
Wait+Screen@6s /Step \d+\/\d+ — Organize/
Sleep 1s
Type "o"

# Real suggestPlacements() review modal opened.
Wait+Screen@10s /Suggested placements/
Sleep 2s
Enter

# Step 7/19 — back to Folders, walk down into the organized folder
# (Root → New → customers → nimbustech — 4 downs). No stable
# subtitle/modal to anchor this arrival on — numbered exception.
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

# Step 10/19 — Reuse
Wait+Screen@6s /Step \d+\/\d+ — Reuse/
Sleep 1s
Type "c"

# Real inherited-context viewer open.
Wait+Screen@10s /Context ·/
Sleep 2s
Escape

# Step 12/19 — Knowledge review
Wait+Screen@6s /Step \d+\/\d+ — Knowledge Review/
Sleep 1s
Type "k"

# Real knowledge review modal open.
Wait+Screen@10s /Review knowledge updates/
Sleep 2s
Enter

# Step 14/19 — Merge (select the top 2 rows, Shift+M)
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

# Step 16/19 — Split
Wait+Screen@6s /Step \d+\/\d+ — Split/
Sleep 1s
Type "S"

# Real split-boundary review modal open.
Wait+Screen@10s /Proposed split/
Sleep 2s
Enter

# Step 18/19 — freeform explore. No stable subtitle/modal to anchor this
# arrival on — numbered exception.
Wait+Screen@6s /Step 18\/19/
Sleep 2s
Enter

# Step 19/19 — final recap. Hold long enough to read it, then exit.
Wait+Screen@6s /Step \d+\/\d+ — Complete!/
Sleep 6s
Type "q"
Sleep 1s
