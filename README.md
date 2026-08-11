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

- Node.js ≥ 22.13, git
- AI agents: `claude` / `codex` / `kiro-cli`

## Install

```sh
npm install -g @krapi0314/mycelium   # then run `mycelium` from anywhere, like k9s
```

To hack on it, clone instead:
```sh
git clone https://github.com/krapie/mycelium.git
cd mycelium && npm install && npm link
```

## Getting Started

```sh
mycelium scan   # import Claude/Codex/Kiro sessions from this machine
mycelium        # launch the TUI — first run offers a quick interactive tutorial
```

Capture never auto-assigns a folder — press `o` (smart organize) in the TUI,
or run `mycelium organize`, to sort new sessions by content.

Re-run the tutorial (or use it as a demo) any time with `mycelium demo` — a
separate `~/.mycelium-demo` store, your real data is never touched. You'll
be asked to pick a language (English or 한국어) and then a persona (software
engineer, cloud support engineer, or solutions architect) so the walkthrough
uses mock sessions that match your own kind of work, fully in the language
you picked. Finish the whole walkthrough and it hands off straight into your
real sessions, continuing in whichever language you picked for the demo
(only on finishing — an early `Esc` bail just exits without touching your
real settings, so previewing the demo in a different language never
silently changes them).

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
[`AGENT.md`](./AGENT.md) first — a dense reference covering conventions, key
bindings, and the contributing workflow.
