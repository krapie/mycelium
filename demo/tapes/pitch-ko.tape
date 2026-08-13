# Flagship ~3-minute pitch video (Korean) — mirrors pitch-en.tape exactly
# except the seeded locale, the banner files, and the Wait markers that
# need to match real Korean UI text (organize/classify.js's suggestPlacements
# review modal title is genuinely Korean when locale is ko — config.js's
# contentLocale() — and so is i18n.js's context.title). The generated
# KNOWLEDGE.md's own "# <folder> — Project Knowledge" header stays English
# in both locales (insight.js never localized that one static wrapper
# line), so that Wait marker is identical to the English tape. See
# pitch-en.tape's own header comment for the full rationale (real LLM
# calls, no post-processing needed, safety design) — not repeated here.

Output "demo/out/pitch-ko.mp4"

Require node
Set Shell "bash"
Set FontSize 15
Set Width 1600
Set Height 900
Set Theme "Dracula"
Set Padding 0
Set TypingSpeed 40ms
# Safety margin against real-LLM timing variance — see pitch-en.tape's own
# comment (one real Korean render came in at 203s, over the 3-minute cap,
# even though English renders of the same script landed at 141-164s).
Set PlaybackSpeed 1.25

# ── Setup (hidden) ──
Hide
Env MYCELIUM_HOME "/tmp/mycelium-vhs-pitch-ko"
Type "node demo/seed-pitch-demo.js ko"
Enter
Sleep 2s
Type "mycelium() { node demo/pitch-launch.js; }"
Enter
Type "clear"
Enter
Show

# ── Why + What ──
Hide
Type "cat demo/banners/intro-ko.txt"
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
Wait+Screen@180s /제안된 폴더 배치/
Sleep 2s
Enter
Sleep 2s

# Back to Folders, walk down into a newly-organized folder — same
# generic 3-downs approach as the English tape (real LLM classification
# isn't perfectly reproducible run to run, so this doesn't assume any
# specific folder name, just "the 3rd item alphabetically").
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
Wait+Screen@10s /컨텍스트 ·/
Sleep 3s
Escape

# ── Outro (quit first — see pitch-en.tape's comment for why) ──
Sleep 1s
Type "q"
Sleep 500ms
Type "q"
Sleep 1500ms
Hide
Type "clear"
Enter
Show
Type "cat demo/banners/outro-ko.txt"
Enter
Sleep 8s
