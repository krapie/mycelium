**[← Back to README](../README.md)**

# CLI (for scripting)

Everything works as individual commands without the TUI:

```sh
# Capture / Organize
mycelium scan                                  # capture only, no folder assignment
mycelium organize [--apply] [--limit N] [--folder <path>]  # content-based folder suggestions (summarizes first, can suggest new folders, --folder narrows to one folder+subfolders, preview-only until --apply, 200 per run by default)
mycelium mkdir company/platform/auth
mycelium mv <session> company/platform/auth
mycelium tag <session> +urgent -miscategorized
mycelium unmerge <session>                     # undo a TUI Shift+M merge
mycelium unsplit <session>                     # undo a TUI Shift+S split

# Learn
mycelium autotag                               # retroactively summarize/tag past sessions in bulk
mycelium digest [week] [--date YYYY-MM-DD]
mycelium knowledge company/platform/auth

# Reuse / Find
mycelium context <session>
mycelium inject --dir <project> --folder <folder> # inject knowledge into AGENTS.md (+ a CLAUDE.md bridge, since Claude Code doesn't read AGENTS.md on its own)
mycelium handoff <session>                     # print a handoff prompt
mycelium resume <session|prefix> [--copy|--exec] # print/copy/immediately run the resume command
mycelium search "query" --tag infra --folder company
mycelium list / tags / reindex

# (optional) keep background upkeep running without the TUI
mycelium daemon                 # run in the foreground
mycelium daemon --detach        # run detached in the background (idempotent)
mycelium daemon --stop          # stop it

# interactive tutorial with fake sessions — the full lifecycle (organize, learn,
# reuse, merge/split), LLM calls mocked so it's fast and deterministic;
# separate ~/.mycelium-demo store, your real data is never touched. Asks for
# a language and a persona (matching mock content) before seeding.
# Finishing the whole tutorial hands off straight into a real TUI session
# (your actual ~/.mycelium) IN THE SAME LANGUAGE you picked for the demo —
# only on a full finish, never on an early Esc bail, so previewing the demo
# in a different language never silently changes your real setting.
mycelium demo

# TUI display language (default en) — takes effect on the next TUI launch.
# Also settable from inside a running TUI session with the `l` key (confirm,
# then Mycelium restarts to apply it), or via the language picker shown on
# first launch / before every `mycelium demo` persona pick.
mycelium lang        # check current setting
mycelium lang ko      # switch to Korean
mycelium lang en      # switch to English

mycelium --version   # (also -v / -V) print the installed version and exit
```

**Opening `mycelium` (the TUI) normally already runs background upkeep
(scan/organize/digest/knowledge review) inside the TUI process itself** — no need to run
`mycelium daemon` or any script separately. **Closing the TUI stops upkeep
too** — no process is left behind, so the next launch always starts fresh
with whatever code is currently installed. Turn this auto-upkeep off with
the `MYCELIUM_NO_AUTOSTART=1` environment variable if you don't want it.

## Cleanup (experimental stage)

```sh
mycelium cleanup            # (= tidy) safe: removes Mycelium's own LLM-call sessions
                            #  + empty folders + rebuilds the index. Safe to run any time.
mycelium cleanup folders    # remove empty folders only
mycelium cleanup archive    # delete sessions filed under _archive from the store
mycelium cleanup index      # rebuild just the sqlite index (if search looks off)
mycelium cleanup reset --yes # full reset: delete ~/.mycelium entirely → re-scan
```

- **`tidy` (default), `folders`, and `index` are safe** — they never delete
  original sessions (`raw/`).
- **`archive`** deletes sessions filed under `_archive` from the store. The
  original `~/.claude`/`~/.codex`/`~/.kiro` logs are untouched, so a
  re-`scan` brings them back — but this time unfiled (they don't
  auto-return to `_archive`; that's manual-placement only).
- **`reset --yes` cannot be undone** — it deletes all of `~/.mycelium`
  (normalized sessions, folders, knowledge, index). It still doesn't touch
  the original agent session logs, so `mycelium scan` rebuilds it from
  scratch.

For a clean start: `mycelium cleanup reset --yes && mycelium scan`.

## Background-only, no TUI (optional)

If you want scanning/organizing/digests to keep running without keeping the
TUI open (headless use, always-on on a server), start a detached daemon
process explicitly:
```sh
mycelium daemon --detach    # no-op if already running (idempotent); logs to ~/.mycelium/daemon.log
mycelium daemon --stop      # stops it if running, no-op otherwise
```
Works the same way whether you installed with `npm install -g` or via
`git clone` (use `node src/cli.js daemon --detach` in the latter case if you
skipped `npm link`). There's no auto-start on reboot — wire
`mycelium daemon --detach` into launchd/systemd/cron yourself if you want
that. **A daemon started this way keeps running whatever code was current
when it started — after updating mycelium, `mycelium daemon --stop` then
`--detach` again to pick up the new code.**

Background upkeep's intervals and limits are all environment-variable
tunable (the defaults are conservative on purpose, so a large backlog
doesn't pile up LLM processes all at once — that pile-up is exactly what
caused Claude's console window to keep popping up on Windows, [#3](https://github.com/krapie/mycelium/issues/3)):

| Env var | Default | Meaning |
|---|---|---|
| `MYCELIUM_SCAN_MS` | 5 min | Scan (capture) interval |
| `MYCELIUM_TAG_BATCH_LIMIT` | 20 | Max sessions auto-summarized/tagged per scan cycle (oldest first, rest next cycle) |
| `MYCELIUM_SMART_ORGANIZE_MS` | 30 min | Smart-organize auto-compute interval |
| `MYCELIUM_SMART_ORGANIZE_LIMIT` | 100 | Max sessions classified per smart-organize cycle |
| `MYCELIUM_SMART_ORGANIZE_COOLDOWN_MS` | 24 h | Wait time before retrying an unmatched session |
| `MYCELIUM_SUMMARIZE_CONCURRENCY` | 3 | Concurrent `claude`/`codex` processes the auto smart-organize cycle spawns |
| `MYCELIUM_DIGEST_KNOWLEDGE_LIMIT` | 10 | Max folders proposed for a knowledge refresh per call, whether triggered by the daemon's independent overnight cycle or the TUI's `k` command computing fresh — unrelated to Digest (`d`) despite the env var's name |
