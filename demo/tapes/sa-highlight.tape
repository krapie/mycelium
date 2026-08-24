# Short highlight (Organize → Learn → Reuse) for the Solutions Architect
# persona — used for README.md's embedded GIF. See demo/README.md for how
# to regenerate. This persona has no existing e2e coverage, so its
# down-navigation depth (Root → New → customers → nimbustech, 4 downs)
# was confirmed with a throwaway interactive dry-run against an isolated
# /tmp store before writing this tape, not guessed.
#
# Markers are anchored on each step's own stable subtitle (or, for the
# handful of titleless "confirm/apply" steps, the real modal content that
# opened right before them) rather than absolute step numbers — see
# swe-highlight.tape's header comment for why.
#
# Safety: see swe-highlight.tape's header comment — same direct
# `tui --tutorial` invocation, same disposable /tmp MYCELIUM_HOME.

Output "demo/out/sa-highlight.gif"

Require node
Set Shell "bash"
Set FontSize 15
Set Width 1600
Set Height 900
Set Theme "Dracula"
Set Padding 0
Set TypingSpeed 40ms

Hide
Env MYCELIUM_HOME "/tmp/mycelium-vhs-sa-highlight"
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

# Step 12/19 — closing on a clean, settled list so the GIF loops smoothly.
Wait+Screen@6s /Step \d+\/\d+ — Knowledge Review/
Sleep 2s
