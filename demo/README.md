# Demo recordings

Two kinds of scripted [VHS](https://github.com/charmbracelet/vhs) recording live here.

**Per-persona tutorial walkthroughs** (Software Engineer, Cloud Support Engineer, Solutions Architect — `src/tui/personas.js`), mocked/deterministic:

- `<persona>-highlight.tape` → a short (~20s) Organize → Learn → Reuse loop, sized for embedding directly in `README.md`.
- `<persona>-full.tape` → the complete 16-step tutorial, for YouTube.

**Flagship pitch video** (`pitch-en.tape` / `pitch-ko.tape`), real LLM calls: why Mycelium exists, what it is, how to run it, then a live demo against a richer 12-session/4-folder SWE-flavored dataset (`pitch-data.js`) than the tutorial persona uses — organize, learn, reuse, all narrated by real generated content, not canned mock text. See "The pitch video" section below — its design differs enough from the persona tapes to warrant its own explanation.

Output lands in `demo/out/` (gitignored — not committed; regenerate locally or pull from the `demo-assets` GitHub Release).

## Regenerating

```sh
brew install vhs        # pulls in ttyd; ffmpeg comes along too if you don't have it
npm run record           # renders all six persona tapes into demo/out/
npm run record:pitch     # renders pitch-en.mp4 + pitch-ko.mp4 (real LLM calls — see below)
```

Or render one at a time: `vhs demo/tapes/swe-highlight.tape` (run from the repo root — the tapes' `node src/cli.js ...` / `node demo/pitch-launch.js ...` are relative paths).

## Why it's built this way

**Safety first.** Every tape launches `node src/cli.js tui --tutorial` *directly*, never `mycelium demo`. The `demo` CLI command spawns a child with an isolated `MYCELIUM_HOME`, and on a **completed** tutorial run the *parent* (unmodified env) re-execs into your **real** `~/.mycelium` data in the same terminal — exactly what a recording must never show. The direct-invoke path has no parent watching for that handoff, so even a tape that runs all the way to the end and presses the final `q` (the `-full` tapes do) just exits cleanly back to the shell. Every tape also sets its own throwaway `MYCELIUM_HOME` under `/tmp` via VHS's `Env` command — never `~/.mycelium`, never `~/.mycelium-demo`.

**Wait on real text, not guessed timing.** `MYCELIUM_DEMO_MOCK_DELAY_MS` is set to 1200ms (vs. the real demo's 5000ms default) for reasonable pacing, but every step still uses VHS's `Wait+Screen@<timeout> /regex/` against the tutorial narrator's own `Step N/16` label (or a modal's real content) instead of a fixed `Sleep` — the same "poll for the real state, don't guess a delay" principle `test/e2e/demo-e2e.test.js`'s own `waitFor()` helper uses, so a render doesn't flake if a step happens to take longer than expected.

**Key sequences are proven, not invented.** `swe`/`cse`'s full sequences translate `test/e2e/demo-e2e.test.js`'s own working key-by-key sequences into VHS commands. `sa` has no e2e coverage — its down-navigation depth to `customers/nimbustech` was confirmed with a one-off interactive dry run against an isolated `/tmp` store before writing the tape, not guessed.

**Dimensions:** `Width 1600, Height 900, FontSize 15, Theme Dracula` — verified against a real render to not truncate/clip any panel content. `docs/tui.md`'s own manual-verification convention uses a much wider 220-column terminal specifically to rule out truncation bugs during testing; 1600px at this font size is narrower than that but was visually confirmed clean for recording purposes. If you change `FontSize`/`Width`, re-render `swe-highlight.tape` first and inspect a frame (`ffmpeg -i demo/out/swe-highlight.gif -vf "select=eq(n\,60)" -fps_mode vfr /tmp/check.png`) before re-rendering the rest.

## The pitch video

Deliberately built differently from the persona tapes above — no tutorial narrator (a promo shouldn't read as a product tour), a richer dataset than the 6-session persona, and **real** LLM calls instead of the mocked/deterministic provider the persona tapes use, since this is a one-off production where authentic results matter more than perfect repeatability.

**Safety — the one rule that matters most.** `demo/pitch-launch.js` mounts `sessionsView()` directly, deliberately skipping `runTui()`'s `startTuiRoutine()` call. That call runs a real `scanCycle()` immediately on startup, and adapters always read the actual `~/.claude`/`~/.codex`/`~/.kiro` history regardless of `MYCELIUM_HOME` — confirmed live that a normal launch against even a disposable `MYCELIUM_HOME` surfaced real personal session titles within seconds. Every command that touches the data layer (the seed script, the `mycelium()` shell function) must run under the tape's own `Env MYCELIUM_HOME` — **every single one**, no exceptions. An earlier version of `pitch-en.tape` set `MYCELIUM_HOME` only on the later `mycelium()` function definition, not on the seed command itself; the seed ran against the real `~/.mycelium` (`paths.js`'s own default) and wrote 12 fake sessions into it. Caught by checking the real store's session count before/after (AGENTS.md's own standing advice) and cleaned up with `scanner.js`'s real `deleteRaw()` on the exact 12 identified-by-content ids, then `reindex()` to drop the resulting stale index entries — not a raw `rm`. If you're editing these tapes, re-read this paragraph before touching the `Env`/seed lines.

**`seed-pitch-demo.js` is idempotent, not additive.** Each session gets a fresh `randomUUID()` — there's no stable id to overwrite by — so re-running it against a `MYCELIUM_HOME` that already has a prior run's data used to just pile up more sessions on top (found by hand: a second render of the same `/tmp` path ended up with 24 sessions instead of 12). Worse, clearing only the raw session files wasn't enough either — `TREE_DIR` (real folder directories, created by a previous run's `applyPlacements()`) survived that and left stale **empty** folders sitting alongside the real ones; a tape's alphabetical down-navigation landed on one of those by chance once, and pressing `w` found nothing to summarize, timing out waiting for a `KNOWLEDGE.md` draft that was never coming. The script now clears `RAW_DIR`/`TREE_DIR`/`DIGEST_DIR` up front, every run, so re-rendering against the same `/tmp` path is always a clean slate.

**The app must actually quit before the outro.** `mycelium` runs fullscreen (alternate-screen mode) for the entire live-demo section — everything typed after it launches goes to the app itself, not a shell. An earlier version of the outro skipped pressing `q`/`q` (the real quit-confirm, `app.js`'s `confirmQuit()`) before `Hide`-ing to `clear`/`cat` the outro banner; those became random keystrokes the still-running app mostly ignored, and the outro simply never appeared in the rendered output, with no error from VHS (the whole script "succeeded" — every command in the log ran, just against the wrong target).

**Wait timeouts need real margin, not your one measured sample.** Organize (summarize + classify, 12 sessions) ranged **110-150s+** across several real renders; a single Learn call (one folder's few sessions) that measured ~11s once still needs a much more generous timeout than that one sample suggests — a render that hit real API latency variance timed out at 60s before 120s turned out to be safely generous. `Wait+Screen@<timeout>` timeouts in both tapes are set well above the worst real measurement seen, not the average.

**Fitting the 3-minute cap despite real, variable LLM timing.** One real Korean render came in at 203s — over budget — even though English renders of the same script had landed at 141-164s. Both tapes now set `Set PlaybackSpeed 1.25` plus trimmed (not eliminated) the fixed intro/outro/hold `Sleep` durations, landing final cuts at 135-147s across renders — real margin against timing variance in either direction, still comfortably watchable (most viewers already play tutorial videos at 1.25-1.5x).

**Wait markers must match the real locale's real UI text.** `suggestPlacements()`'s review-modal title and the context viewer's title are genuinely Korean when `config.json`'s locale is `ko` (`config.js`'s `contentLocale()` — see `AGENTS.md`) — `pitch-ko.tape` waits for `제안된 폴더 배치`/`컨텍스트 ·`, not the English strings. The generated `KNOWLEDGE.md`'s own `# <folder> — Project Knowledge` header stays English in **both** locales (`insight.js` never localized that one static wrapper line, deliberately out of scope for the locale work that made the prompts themselves follow it) — so that one Wait marker is identical in both tapes.

**Real cost.** Both tapes make genuine calls to your actual `claude`/`codex` CLI — real API usage and real wait time, not the instant mocked persona recordings. Render English first and confirm it looks right before spending the same real time+cost rendering Korean.

## Hosting

GIFs/MP4s are **not** committed to git (keeps the repo/clone size lean) and are outside `package.json`'s `"files"` allowlist (`demo/` isn't listed, so `npm publish` never bundles them either). The persona recordings are uploaded as assets on a GitHub Release (`demo-assets`); `README.md`'s embedded GIF points at that release's stable download URL. `pitch-en.mp4`/`pitch-ko.mp4` are handed off locally for manual YouTube upload — not linked from `README.md` and not assumed to go on the same release unless asked.
