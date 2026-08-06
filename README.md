# Mycelium

[![npm version](https://img.shields.io/npm/v/@krapi0314/mycelium)](https://www.npmjs.com/package/@krapi0314/mycelium)
[![CI](https://github.com/krapie/mycelium/actions/workflows/ci.yml/badge.svg)](https://github.com/krapie/mycelium/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22.13-brightgreen)](https://nodejs.org)

A Context Lifecycle platform that manages context produced by AI
collaboration through **Capture → Organize → Learn → Reuse**. It solves
context loss across model boundaries (Claude Code, Codex, ...), time, and
space.

POC stage — all four lifecycle stages are verified against real local
sessions (Claude Code + Codex + Kiro).

## Requirements

- **Node.js ≥ 22.13** (uses the built-in `node:sqlite` — below 22.13 it's
  not available without the `--experimental-sqlite` flag)
- **git**
- (optional) the **`claude` / `codex` / `kiro-cli` CLIs** — installed and
  logged in, used for generating summaries, resuming, handoff, and launching
  agents. Not needed if you only want to browse/search.

## Install

Like k9s: install once, then just run `mycelium` from anywhere:
```sh
npm install -g @krapi0314/mycelium
```

To hack on it directly, clone instead:
```sh
git clone https://github.com/krapie/mycelium.git
cd mycelium
npm install                 # one dependency: neo-blessed (the TUI)
npm link                    # (optional) registers the global `mycelium` command
```

## Getting Started

```sh
mycelium scan               # import Claude/Codex/Kiro sessions from this machine
mycelium                    # launch the interactive TUI — first run offers a 3-minute tutorial
```

**Capture never auto-assigns a folder** — everything lands unfiled after the
first scan. Press `o` (smart organize) in the TUI, or run
`mycelium organize`, to sort by content.

**Want to see the tutorial again, or use it for a demo? Run it any time:**
```sh
mycelium demo                # interactive tutorial with fake sessions — a completely separate store (~/.mycelium-demo), your real data is never touched
```

> If you installed via `git clone` and skipped `npm link`, run
> `node src/cli.js <command>` instead.

**Everything is per-machine.** Mycelium only reads local sessions on the
machine it runs on (`~/.claude/projects/`, `~/.codex/sessions/`,
`~/.kiro/sessions/cli/` + kiro-cli's SQLite DB) and stores its own data in
that machine's `~/.mycelium/`. Sessions from other machines never show up
automatically.

## Learn More

The full guide lives in [`docs/`](./docs):

- [**TUI (the cockpit)**](./docs/tui.md) — the 3-column interface, folders
  panel, sessions panel, and every keyboard shortcut
- [**Learn/Reuse loop**](./docs/learn-reuse.md) — how a finished session's
  knowledge reaches the next one, and what's automatic vs. manual
- [**Handoff lifecycle**](./docs/handoff.md) — continuing work across
  different agent CLIs
- [**CLI reference**](./docs/cli.md) — every `mycelium` subcommand, for
  scripting or running without the TUI
- [**Data location, design principles, and status**](./docs/architecture.md)
- [**Feature catalog**](./docs/features.md) — every capability as a user
  story, with its invariants and test-coverage status

## Cleanup (experimental stage)

Still experimental, so sessions/folders can get messy while testing. Clean
up with `cleanup`:

```sh
mycelium cleanup            # (= tidy) safe cleanup: removes Mycelium's own LLM-call sessions
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

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) — includes the dev setup, how to
run lint/tests, and how to add support for a new AI agent CLI.
