# Mycelium

[![npm version](https://img.shields.io/npm/v/@kevinprk/mycelium)](https://www.npmjs.com/package/@kevinprk/mycelium)
[![CI](https://github.com/krapie/mycelium/actions/workflows/ci.yml/badge.svg)](https://github.com/krapie/mycelium/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22.13-brightgreen)](https://nodejs.org)

**Organize your AI sessions, and make each one smarter than the last.**

Sessions pile up fast — one per case, one per feature, one per bug — and whatever's reusable in them (a root cause, a convention, a customer-facing tone) disappears with each one. Mycelium organizes sessions around the work they belong to, and **Learn** distills what repeats into `AGENTS.md`, so the next similar session already knows it.

- **Capture** — Claude Code, Codex, and Kiro sessions land in one place, automatically.
- **Organize** — grouped by the project, case, or service they actually belong to.
- **Learn** — what repeats across a folder's sessions becomes durable knowledge.
- **Reuse** — injected into your next session, or handed to a different agent.

**Example**: a support engineer files one session per case under `cases/onprem-connectivity`. After a few cases, Learn extracts *"MTU mismatch is the default suspect for large-payload on-prem↔VPC failures"* — the next case in that folder starts already knowing it.

Local-first, model-agnostic, human-controlled. *Sessions end. Project knowledge shouldn't.*

POC stage — all four stages verified against real local sessions (Claude Code + Codex + Kiro).

## Demo

![mycelium demo — a Cloud Support Engineer's cases, organized and learned from](https://github.com/krapie/mycelium/releases/download/demo-assets/cse-highlight.gif)

`mycelium demo` walks through the same loop interactively — try it with
`npm install -g @kevinprk/mycelium && mycelium demo`, or see it as a
Software Engineer / Solutions Architect instead of a Cloud Support
Engineer by picking a different persona when it asks.

## Requirements

> **Mycelium uses your own LLM usage.** `organize`, `autotag`, `knowledge`,
> and split suggestions call your own `claude`/`codex` CLI — including
> automatically in the background while mycelium is open. Disable with
> `MYCELIUM_NO_AUTOSTART=1`, or tune it in [`docs/cli.md`](./docs/cli.md).

- Node.js ≥ 22.13, git
- AI agents: `claude` / `codex` / `kiro-cli`

## Install

```sh
brew install krapie/tap/mycelium    # via Homebrew
# or
npm install -g @kevinprk/mycelium   # then run `mycelium` from anywhere
```

To hack on it, clone instead:
```sh
git clone https://github.com/krapie/mycelium.git
cd mycelium && npm install && npm link
```

## Getting Started

```sh
mycelium        # launch the TUI — first run offers a guided tour
mycelium demo   # try it risk-free first — separate store, your real data untouched
```

Sessions from Claude Code, Codex, and Kiro are captured automatically in the
background — no manual scan needed. Day to day it's a simple loop, the
**Context Flywheel**: `s` capture → `o` organize → `k` learn → `n` start the
next session with everything it needs. Most of that already runs by itself
in the background; pressing these keys is mostly reviewing and confirming
what's already waiting for you.

`mycelium demo` walks through that same loop against mock sessions, in your
choice of language and persona, then hands off straight into your real
sessions once you finish it — an early `Esc` bail just exits, your actual
`~/.mycelium` store untouched either way.

Display language defaults to English — switch any time with
`mycelium lang <en|ko>`, the in-TUI `l` key, or the language picker shown on
first launch.

> Skipped `npm link`? Use `node src/cli.js <command>` instead.

Mycelium stores everything on your machine (`~/.mycelium/`) with no
server or telemetry — safe to use inside restricted orgs that already
permit `claude`/`codex`. Just note that its LLM calls
(organize/autotag/knowledge) do carry session content to the provider,
the same as any direct CLI use.

## Learn More

Full guide in [`docs/`](./docs):

- [**TUI**](./docs/tui.md) — the 3-column interface + every keyboard shortcut
- [**Learn/Reuse loop**](./docs/learn-reuse.md) — how sessions pass knowledge forward
- [**Handoff**](./docs/handoff.md) — continuing work across agent CLIs
- [**CLI reference**](./docs/cli.md) — every subcommand, for scripting
- [**Architecture**](./docs/architecture.md) — data location, design principles, status
- [**Feature catalog**](./docs/features.md) — every capability, with test-coverage status

## Cleanup (experimental stage)

```sh
mycelium cleanup            # safe: removes Mycelium's own LLM-call sessions + empty folders, rebuilds the index
mycelium cleanup reset --yes # irreversible: wipes ~/.mycelium entirely
```

`tidy`/`folders`/`archive`/`index`/`reset` never touch your original agent
logs, so `mycelium scan` can always rebuild — see
[`docs/cli.md`](./docs/cli.md) for the full breakdown.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for dev setup, lint/test, and how
to add a new AI agent CLI.

## Working in this Repo with an AI Agent

Using Claude Code, Codex, Cursor, or similar on Mycelium itself? Point it at
[`AGENTS.md`](./AGENTS.md) first — a dense reference covering conventions, key
bindings, and the contributing workflow. (Claude Code doesn't read AGENTS.md
on its own, so `CLAUDE.md` in this repo's root just imports it.)
