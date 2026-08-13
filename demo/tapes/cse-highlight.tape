# Short highlight (Organize → Learn → Reuse) for the Cloud Support
# Engineer persona — used for README.md's embedded GIF. See
# demo/README.md for how to regenerate and why these settings were
# chosen. Mirrors swe-highlight.tape exactly except the persona-picker
# selection and the down-navigation depth to this persona's own
# merge-target folder (cases/onprem-connectivity — see
# test/e2e/demo-e2e.test.js's cse-persona test for where the 3-down count
# comes from).
#
# Safety: see swe-highlight.tape's header comment — same direct
# `tui --tutorial` invocation, same disposable /tmp MYCELIUM_HOME.

Output "demo/out/cse-highlight.gif"

Require node
Set Shell "bash"
Set FontSize 15
Set Width 1600
Set Height 900
Set Theme "Dracula"
Set Padding 0
Set TypingSpeed 40ms

Hide
Env MYCELIUM_HOME "/tmp/mycelium-vhs-cse-highlight"
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

# Step 9/16 — closing on a clean, settled list so the GIF loops smoothly.
Wait+Screen@6s /Step 9\/16/
Sleep 2s
