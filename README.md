# Mycelium

[![npm version](https://img.shields.io/npm/v/@kevinprk/mycelium)](https://www.npmjs.com/package/@kevinprk/mycelium)
[![CI](https://github.com/krapie/mycelium/actions/workflows/ci.yml/badge.svg)](https://github.com/krapie/mycelium/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22.13-brightgreen)](https://nodejs.org)

A Context Lifecycle platform that manages context produced by AI
collaboration through **Capture → Organize → Learn → Reuse**. It solves
context loss across model boundaries (Claude Code, Codex, ...), time, and
space.

POC stage — all four lifecycle stages are verified against real local
sessions (Claude Code + Codex + Kiro).

## Demo

![mycelium demo — Organize, Learn, Reuse](https://github.com/krapie/mycelium/releases/download/demo-assets/swe-highlight.gif)

`mycelium demo` walks through the same loop interactively — try it with
`npm install -g @kevinprk/mycelium && mycelium demo`, or see it as a
Cloud Support Engineer / Solutions Architect instead of a Software
Engineer by picking a different persona when it asks.

## Requirements

- Node.js ≥ 22.13, git
- AI agents: `claude` / `codex` / `kiro-cli`

## Install

```sh
brew install krapie/tap/mycelium    # via Homebrew
# or
npm install -g @kevinprk/mycelium   # then run `mycelium` from anywhere, like k9s
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

Everything is per-machine: Mycelium only reads sessions on the machine it
runs on and stores its own data in that machine's `~/.mycelium/`.

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
