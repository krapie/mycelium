# Short highlight (Organize → Learn → Reuse) for the Software Engineer
# persona — used for README.md's embedded GIF. See demo/README.md for how
# to regenerate and why these settings were chosen.
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

# Step 1/16 — intro + panel-nav merged: Enter both advances the narrator
# and performs the real "step into Sessions" action (see tutorial.js).
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

# Step 4/16 — back to Folders, then walk down into the now-organized folder
# (Root → New → retail-website → express-reorder, alphabetical — 4 downs).
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

# Step 9/16 — closing on a clean, settled list (not mid-modal) so the GIF
# loops smoothly. Highlight ends here — no merge/split/recap.
Wait+Screen@6s /Step 9\/16/
Sleep 2s
