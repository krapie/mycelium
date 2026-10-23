**[← Back to README](../README.md)**

# CLI (for scripting)

Everything works as individual commands without the TUI. Wherever a command takes `<session>`, the 8-character id `mycelium list` prints (or any unique prefix) works as well as the full id:

```sh
# Capture / Organize
mycelium scan                                  # capture only, no folder assignment
mycelium organize [--apply] [--limit N] [--folder <path>]  # content-based folder suggestions (summarizes first, can suggest new folders, --folder narrows to one folder+subfolders, preview-only until --apply)
mycelium organize --set-limit N                 # sessions one organize run may process, in the TUI's o and here (default 30); --limit N overrides it for one run
mycelium mkdir company/platform/auth
mycelium mv <session> company/platform/auth
mycelium tag <session> +urgent -miscategorized
mycelium unmerge <session>                     # undo a TUI Shift+M merge
mycelium unsplit <session>                     # undo a TUI Shift+S split

# Backlog (something to work on later, written before any agent has run)
mycelium backlog add "Fix the flaky scan test" --desc "starts failing above ~200 sessions" --folder company/platform
mycelium backlog list [--folder f]             # items still waiting (an item disappears when the session it started is captured)
mycelium backlog open <session|prefix> [--agent a] [--dir D] [--copy]  # print the command that starts it, seeded with your notes (that session replaces the item on the next scan)

# Clip (pin part of a conversation verbatim — same as TUI p)
mycelium clip add <session>                    # no --turn: print the session's turns, numbered
mycelium clip add <session> --turn 12-13 --note "prompt caching layout"
mycelium clip list [--folder f] [--session s]
mycelium clip show <clip> / rm <clip>
mycelium clip note <clip> "new note"           # replace (or, with nothing after the id, clear) a clip's note
mycelium clip add --here [--last N]            # from inside an agent: the session it's in, its last N turns ending at the newest answer (default 1)
                                               # --skip-request: the newest user turn is the pin request itself, end before it
mycelium clip add --here --list [N]            # the N (default 10) newest answers, one per question, with the turn numbers --turn takes
                                               # Claude Code: copy src/agent-commands/claude/clip.md to ~/.claude/commands/ and type /clip [note]
                                               # Kiro CLI: copy src/agent-commands/kiro/clip.md to ~/.kiro/prompts/ and type @clip [note]
                                               # Codex: copy the src/agent-commands/codex/clip/ directory to ~/.codex/skills/ and type $clip [note] (not yet verified end to end)

# Learn
mycelium autotag                               # retroactively summarize/tag past sessions in bulk
mycelium digest [week] [--date YYYY-MM-DD]
mycelium knowledge company/platform/auth

# Reuse / Find
mycelium context <session>
mycelium inject --dir <project> --folder <folder> # inject knowledge into AGENTS.md (+ a CLAUDE.md bridge, since Claude Code doesn't read AGENTS.md on its own)
mycelium handoff <session>                     # print a handoff prompt
mycelium resume <session|prefix> [--copy|--exec] [--force] # print/copy/immediately run the resume command (points to handoff if the agent no longer has the session; --force skips that check)
mycelium search "query" --tag infra --folder company
mycelium list / tags / reindex

# (optional) keep background upkeep running without the TUI
mycelium daemon                 # run in the foreground
mycelium daemon --detach        # run detached in the background (idempotent)
mycelium daemon --stop          # stop it

# interactive tutorial with fake sessions, the full lifecycle (organize, learn,
# reuse, merge/split), LLM calls mocked so it's fast and deterministic.
# Separate ~/.mycelium-demo store, your real data is never touched. Asks for
# a language and a persona (matching mock content) before seeding.
# Finishing the whole tutorial hands off straight into a real TUI session
# (your actual ~/.mycelium) IN THE SAME LANGUAGE you picked for the demo,
# only on a full finish, never on an early Esc bail, so previewing the demo
# in a different language never silently changes your real setting.
mycelium demo

# TUI display language (default en), takes effect on the next TUI launch.
# Also settable from inside a running TUI session with the `l` key (confirm,
# then Mycelium restarts to apply it), or via the language picker shown on
# first launch / before every `mycelium demo` persona pick.
mycelium lang        # check current setting
mycelium lang ko      # switch to Korean
mycelium lang en      # switch to English

mycelium --version   # (also -v / -V) print the installed version and exit
```

**Opening `mycelium` (the TUI) already runs background upkeep (scan/organize/digest/knowledge review) inside the TUI process itself.** No need to run `mycelium daemon` or any script separately. **Closing the TUI stops upkeep too.** No process is left behind, so the next launch always starts fresh with whatever code is currently installed. Turn this auto upkeep off with the `MYCELIUM_NO_AUTOSTART=1` environment variable if you don't want it.

## Cleanup (experimental stage)

```sh
mycelium cleanup            # (= tidy) safe: removes Mycelium's own LLM-call sessions
                            #  + empty folders + rebuilds the index. Safe to run any time.
mycelium cleanup folders    # remove empty folders only
mycelium cleanup archive    # delete sessions filed under _archive from the store
mycelium cleanup index      # rebuild just the sqlite index (if search looks off)
mycelium cleanup reset --yes # full reset: delete ~/.mycelium entirely → re-scan
```

- **`tidy` (default), `folders`, and `index` are safe.** The original agent logs (`~/.claude`, `~/.codex`, `~/.kiro`, OpenCode's `opencode.db`) are always untouched. `tidy` does remove Mycelium's own synthetic meta-call records from `raw/` (sessions Mycelium's own LLM calls accidentally left behind), never a real captured session.
- **`archive`** deletes sessions filed under `_archive` from the store.
  The original `~/.claude`/`~/.codex`/`~/.kiro` logs and OpenCode's own
  `opencode.db` are untouched, so a re-scan brings them back, but this
  time unfiled. They don't automatically return to `_archive`; that's
  manual placement only.
- **`reset --yes` cannot be undone.** It deletes all of `~/.mycelium`
  (normalized sessions, folders, knowledge, index). It still doesn't
  touch the original agent session logs, so `mycelium scan` rebuilds it
  from scratch.

For a clean start: `mycelium cleanup reset --yes && mycelium scan`.

## Setup

```sh
mycelium setup             # install /clip into every agent CLI that's on PATH
mycelium setup --dry-run   # print the same table without writing anything
```

Copies this version's command files to where each agent looks for them — `~/.claude/commands/clip.md`, `~/.kiro/prompts/clip.md`, `~/.codex/skills/clip/SKILL.md` — skipping any agent whose CLI isn't installed. Each file gets a marker line recording the hash of what was written, so a later run can tell the three cases apart and report one of: `installed`, `updated` (ours, and this version ships a newer copy), `already current`, `edited since install` or `not installed by Mycelium`. Only the first two write; a file you edited, or one that was never Mycelium's, is left exactly as it is. Re-running after a `mycelium` upgrade is the intended way to refresh them.

Codex is the one agent needing a step this command won't take for you: its sandbox denies writes outside the workspace, so `$clip` can't reach the store until `~/.mycelium` is in `writable_roots`. `setup` prints the lines to paste on every run; widening a sandbox is a security decision, so it is never applied automatically. `mycelium doctor` reports whether it's still missing.

## Diagnose

```sh
mycelium doctor            # environment report to paste into a bug report
mycelium doctor --json     # same data as JSON
```

Prints the Mycelium and Node versions, platform and shell, the PATH this process actually has, where each agent CLI (`claude`, `codex`, ...), `git` and `ssh` resolve to (or `NOT FOUND`), the state of each agent command `mycelium setup` manages (plus whether Codex's sandbox still blocks the store), and the store state (session count, index, daemon). Your home directory is shown as `~`.

## Editor integration

```sh
mycelium serve --stdio    # newline-delimited JSON-RPC 2.0 on stdin/stdout; exits when stdin closes
```
Not meant to be run by hand. The VS Code extension (see [VS Code](./vscode.md)) starts it and talks to it, so an editor never imports this package's modules or needs its own `node:sqlite`. Anything the methods print goes to stderr; stdout carries only responses and progress notifications for the LLM-backed methods.

## Background-only, no TUI (optional)

If you want scanning, organizing, and digests to keep running without the TUI open (headless use, always on a server), start a detached daemon process explicitly:
```sh
mycelium daemon --detach    # no-op if already running the current version (idempotent); logs to ~/.mycelium/daemon.log
mycelium daemon --stop      # stops it if running, no-op otherwise
```
Works the same way whether you installed with `npm install -g` or via `git clone` (use `node src/cli.js daemon --detach` in the latter case if you skipped `npm link`). There's no auto-start on reboot; wire `mycelium daemon --detach` into launchd, systemd, or cron yourself if you want that. After you update mycelium, the running daemon notices within a minute and restarts itself on the new code. `mycelium daemon --detach` also replaces a daemon that is on a different version, and `mycelium doctor` flags a stale one. If you run `mycelium daemon` under launchd or systemd, the daemon exits after an update so your supervisor restarts it.

Background upkeep's intervals and limits are all environment variable tunable. The defaults are conservative on purpose, so a large backlog doesn't pile up LLM processes all at once. That pile-up is exactly what caused Claude's console window to keep popping up on Windows, [#3](https://github.com/krapie/mycelium/issues/3):

| Env var | Default | Meaning |
|---|---|---|
| `MYCELIUM_SCAN_MS` | 5 min | Scan (capture) interval |
| `MYCELIUM_TAG_BATCH_LIMIT` | 20 | Max sessions auto-summarized/tagged per scan cycle (oldest first, rest next cycle) |
| `MYCELIUM_SMART_ORGANIZE_MS` | 30 min | Smart-organize auto-compute interval |
| `MYCELIUM_SMART_ORGANIZE_LIMIT` | 100 | Max sessions classified per smart-organize cycle |
| `MYCELIUM_SMART_ORGANIZE_COOLDOWN_MS` | 24 h | Wait time before retrying an unmatched session |
| `MYCELIUM_SUMMARIZE_BATCH_LIMIT` | 30 | Sessions one organize run (`o`, `mycelium organize`) may process, until `mycelium organize --set-limit N` saves a value of its own |
| `MYCELIUM_SUMMARIZE_CONCURRENCY` | 3 | Concurrent `claude`/`codex` processes the auto smart-organize cycle spawns |
| `MYCELIUM_DIGEST_KNOWLEDGE_LIMIT` | 10 | Max folders proposed for a knowledge refresh per call, whether triggered by the daemon's independent overnight cycle or the TUI's `k` command computing fresh. Unrelated to Digest (`d`) despite the env var's name |
