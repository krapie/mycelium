# Demo recordings

Scripted [VHS](https://github.com/charmbracelet/vhs) recordings of `mycelium demo`, one pair per persona (Software Engineer, Cloud Support Engineer, Solutions Architect — `src/tui/personas.js`):

- `<persona>-highlight.tape` → a short (~20s) Organize → Learn → Reuse loop, sized for embedding directly in `README.md`.
- `<persona>-full.tape` → the complete 16-step tutorial, for YouTube.

Output lands in `demo/out/` (gitignored — not committed; regenerate locally or pull from the `demo-assets` GitHub Release).

## Regenerating

```sh
brew install vhs   # pulls in ttyd; ffmpeg comes along too if you don't have it
npm run record     # renders all six tapes into demo/out/
```

Or render one at a time: `vhs demo/tapes/swe-highlight.tape` (run from the repo root — the tapes' `node src/cli.js ...` is a relative path).

## Why it's built this way

**Safety first.** Every tape launches `node src/cli.js tui --tutorial` *directly*, never `mycelium demo`. The `demo` CLI command spawns a child with an isolated `MYCELIUM_HOME`, and on a **completed** tutorial run the *parent* (unmodified env) re-execs into your **real** `~/.mycelium` data in the same terminal — exactly what a recording must never show. The direct-invoke path has no parent watching for that handoff, so even a tape that runs all the way to the end and presses the final `q` (the `-full` tapes do) just exits cleanly back to the shell. Every tape also sets its own throwaway `MYCELIUM_HOME` under `/tmp` via VHS's `Env` command — never `~/.mycelium`, never `~/.mycelium-demo`.

**Wait on real text, not guessed timing.** `MYCELIUM_DEMO_MOCK_DELAY_MS` is set to 1200ms (vs. the real demo's 5000ms default) for reasonable pacing, but every step still uses VHS's `Wait+Screen@<timeout> /regex/` against the tutorial narrator's own `Step N/16` label (or a modal's real content) instead of a fixed `Sleep` — the same "poll for the real state, don't guess a delay" principle `test/e2e/demo-e2e.test.js`'s own `waitFor()` helper uses, so a render doesn't flake if a step happens to take longer than expected.

**Key sequences are proven, not invented.** `swe`/`cse`'s full sequences translate `test/e2e/demo-e2e.test.js`'s own working key-by-key sequences into VHS commands. `sa` has no e2e coverage — its down-navigation depth to `customers/nimbustech` was confirmed with a one-off interactive dry run against an isolated `/tmp` store before writing the tape, not guessed.

**Dimensions:** `Width 1600, Height 900, FontSize 15, Theme Dracula` — verified against a real render to not truncate/clip any panel content. `docs/tui.md`'s own manual-verification convention uses a much wider 220-column terminal specifically to rule out truncation bugs during testing; 1600px at this font size is narrower than that but was visually confirmed clean for recording purposes. If you change `FontSize`/`Width`, re-render `swe-highlight.tape` first and inspect a frame (`ffmpeg -i demo/out/swe-highlight.gif -vf "select=eq(n\,60)" -fps_mode vfr /tmp/check.png`) before re-rendering the rest.

## Hosting

GIFs/MP4s are **not** committed to git (keeps the repo/clone size lean) and are outside `package.json`'s `"files"` allowlist (`demo/` isn't listed, so `npm publish` never bundles them either). They're uploaded as assets on a GitHub Release (`demo-assets`); `README.md`'s embedded GIF points at that release's stable download URL. MP4s aren't linked from `README.md` at all — they're meant for manual YouTube upload.
