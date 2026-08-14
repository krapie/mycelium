# Flagship ~3-minute pitch video (Korean) — mirrors pitch-en.tape exactly
# except the seeded locale, the banner files, and the Wait markers that
# need to match real Korean UI text (suggestPlacements()'s review modal
# title, the context viewer's title, the knowledge-review modal title, the
# merge title prompt, the split review modal title, and the handoff
# agent/directory/action pickers + copy notification are all genuinely
# Korean when locale is ko — config.js's contentLocale()). See
# pitch-en.tape's own header comment for the full rationale (mocked, not
# real LLM calls; full lifecycle including handoff; verified via a headless
# dry run) — not repeated here.

Output "demo/out/pitch-ko.mp4"

Require node
Set Shell "bash"
Set FontSize 15
Set Width 1600
Set Height 900
Set Theme "Dracula"
Set Padding 0
Set TypingSpeed 40ms

# ── Setup (hidden) ──
Hide
Env MYCELIUM_HOME "/tmp/mycelium-vhs-pitch-ko"
Env MYCELIUM_DEMO_MOCK_DELAY_MS "5000"
Type "node demo/seed-pitch-demo.js ko"
Enter
Sleep 1s
Type "mycelium() { node demo/pitch-launch.js ko; }"
Enter
Type "clear"
Enter
Show

# ── Why + What ──
Hide
Type "cat demo/banners/intro-ko.txt"
Enter
Show
Sleep 12s
Hide
Type "clear"
Enter
Show

# ── How to run ──
Type "npm install -g @kevinprk/mycelium"
Sleep 2s
Hide
Ctrl+C
Type "clear"
Enter
Show
Type "mycelium"
Enter

# ── Live demo: the full lifecycle ── (pacing rationale: see pitch-en.tape's
# own comment — holds are sized to actually read the screen, not just to
# satisfy the Wait marker; target ~100-120s total)
Wait+Screen@10s /mycelium/
Sleep 2s

Type "o"
Wait+Screen@15s /제안된 폴더 배치/
Sleep 6s
Enter
Sleep 3s

# Root -> New -> auth -> auth/token-refresh — 3 downs, same folder structure
# as the English tape (folder names stay ASCII in both locales).
Left
Sleep 600ms
Down
Sleep 600ms
Down
Sleep 600ms
Down
Sleep 1s
Enter
Sleep 1500ms

Type "w"
Wait+Screen@10s /Project Knowledge/
Sleep 6s
Enter
Sleep 2500ms

Type "c"
Wait+Screen@10s /컨텍스트 ·/
Sleep 6s
Escape
Sleep 1500ms

Type "k"
Wait+Screen@10s /지식 업데이트 검토/
Sleep 5s
Enter
Sleep 2s

Space
Sleep 400ms
Down
Sleep 400ms
Space
Sleep 400ms
Type "M"
Wait+Screen@10s /병합된 세션의 제목/
Sleep 5s
Enter
Sleep 2s

Up
Up
Up
Up
Up
Sleep 500ms

# Merge/split detail drill-ins — see pitch-en.tape's own comment for the
# full rationale (real stitched/sliced content, not just the badge).
Enter
Sleep 6s
Escape
Sleep 500ms

Type "S"
Wait+Screen@10s /분할 제안/
Sleep 5s
Enter
Sleep 2s

Down
Sleep 500ms
Enter
Sleep 6s
Escape
Sleep 500ms

# Handoff — see pitch-en.tape's own comment for the full rationale. 2 downs
# from the split piece reaches the one real, untouched session in this
# folder.
Down
Sleep 500ms
Down
Sleep 1s
Type "h"

Wait+Screen@10s /에이전트 선택/
Sleep 2500ms
Enter

Wait+Screen@10s /작업 디렉토리 선택/
Sleep 2500ms
Enter

Wait+Screen@10s /세션 시작/
Sleep 2s
Down
Enter

Wait+Screen@10s /클립보드에 복사됨/
Sleep 3s

# ── The handoff's real result — see pitch-en.tape's own comment for the
# full rationale (separate-process seed + relaunch, real linkContinuation()).
Sleep 800ms
Type "q"
Sleep 800ms
Type "q"
Sleep 1s
Hide
Type "clear"
Enter
Type "node demo/seed-pitch-continuation.js ko"
Enter
Sleep 1s
Type "mycelium"
Enter
Show
Wait+Screen@10s /mycelium/
Sleep 1500ms

Left
Sleep 600ms
Down
Sleep 600ms
Down
Sleep 600ms
Down
Sleep 1s
Enter
Sleep 2500ms

Enter
Sleep 6s
Escape
Sleep 500ms

# Back to Root scope first — see pitch-en.tape's own comment for why
# (search filters within the current folder, not guessed).
Left
Sleep 500ms
Up
Sleep 300ms
Up
Sleep 300ms
Up
Sleep 500ms
Enter
Sleep 1s

# ── Search — "retry" matches sessions in both auth/token-refresh and
# ci/flaky-tests (confirmed via the same dry-run harness).
Type "/"
Wait+Screen@10s /검색/
Sleep 1s
Type "retry"
Sleep 500ms
Enter
Sleep 4s

# ── Calendar — see pitch-en.tape's own comment for the full rationale
# (answers the intro banner's "Time" pain point). 4 Lefts from today reaches
# a day with 2 real ci/flaky-tests sessions.
Type "v"
Wait+Screen@10s /캘린더/
Sleep 2s
Left
Sleep 400ms
Left
Sleep 400ms
Left
Sleep 400ms
Left
Sleep 2s
Enter
Sleep 2500ms
Enter
Sleep 4s
Escape
Sleep 500ms
Escape
Sleep 500ms
Type "v"
Sleep 500ms

# ── Outro (quit first) ──
Sleep 800ms
Type "q"
Sleep 800ms
Type "q"
Sleep 2s

# Proof: the AGENTS.md the handoff wrote into the real (fake-repo) project
# directory.
Hide
Type "clear"
Enter
Show
Type "cat /tmp/mycelium-vhs-pitch-ko-repos/auth-token-refresh/AGENTS.md"
Enter
Sleep 7s

Hide
Type "clear"
Enter
Show
Type "cat demo/banners/outro-ko.txt"
Enter
Sleep 13s
