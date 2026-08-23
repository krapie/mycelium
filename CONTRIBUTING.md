# Contributing

Mycelium is MIT licensed and accepts contributions via GitHub pull requests. This document covers the contribution workflow, development setup, and a few conventions to help get your change merged smoothly. By participating, you're expected to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Contribution Flow

1. Fork the repository and clone your fork.
2. Create a topic branch off `main`.
3. Make your change. Keep commits to logical units — see "Commit Messages" below.
4. Run `npm run lint` and `npm test`, and add tests for new behavior where it makes sense.
5. Push your branch and open a pull request against `main`.
6. Sign the CLA — a bot will comment on your PR with instructions the first time (see [CLA](#contributor-license-agreement-cla) below).
7. Address review feedback. Once a maintainer approves, it gets merged.

## Development Setup

### Requirements

- [Node.js](https://nodejs.org) >= 22.13.0
- npm

### Getting started

```sh
git clone https://github.com/<you>/mycelium.git
cd mycelium
npm install
npm link          # registers a local `mycelium` binary for manual testing
```

### Linting and testing

```sh
npm run lint       # ESLint — correctness rules only, no formatter
npm test            # node:test — runs test/*.test.js
```

Tests that touch Mycelium's data layer (`src/paths.js` and anything that imports it, transitively) isolate themselves into a temporary `MYCELIUM_HOME` — see `test/helpers.js`'s `useTempHome()` and its doc comment for why those specific test files use dynamic `import()` instead of a normal top-level `import`. Tests must never touch your real `~/.mycelium` store.

## Conventions

### Commit Messages

There's no enforced prefix convention (no `feat:`/`fix:` etc.) — write a short subject line describing *what* changed, then a blank line, then a body explaining *why*. Look at `git log` for the established tone.

### Code Style

No Prettier — the codebase already has a consistent hand-written style; `npm run lint` catches correctness issues (unused variables, etc.), not formatting. Match the surrounding code's style in whatever file you're editing.

### Adding a New AI Agent CLI

Mycelium captures sessions from AI coding-agent CLIs (Claude Code, Codex, Kiro today) through a small adapter interface. Adding support for a new one touches exactly two files:

1. Write `src/adapters/<name>.js` implementing the contract documented in `src/adapters/base.js`: `name`, `label`, `bin`, `newArgs(seed)`, `resumeArgs(sessionId)`, `listSessions()`, `parse(ref)`. Look at `src/adapters/codex.js` for the simplest existing example.
2. Register it in `src/adapters/index.js`'s `ADAPTERS` array.

That's it — scanning, resuming, launching, and the TUI's agent picker all derive from that one registry. The one thing NOT covered by the adapter is a display color for the TUI (`src/tui/theme.js`'s `sourceColor()`) — pick one that's visually distinct from the existing agents' colors and add it there; this is deliberately kept out of the adapter contract so `src/adapters/` never needs to import from `src/tui/`.

Add a couple of tests to `test/adapters.test.js` following the existing `claude`/`codex`/`kiro` examples — a fixture transcript plus a `parse()` assertion is usually enough.

## Contributor License Agreement (CLA)

We require contributors to sign our [CLA](./CLA.md) before we can accept a contribution. Open a pull request to sign — a bot will comment asking you to reply with a specific sentence to confirm. You only need to do this once; it covers all your future contributions to this repository.

Agreeing to the CLA states that you're entitled to submit your contribution and that the Project can use it under its open-source license. This is a common, well-accepted practice in open source (Apache Software Foundation projects, Google, and many others all require one) and doesn't change the fact that the Project itself stays under a permissive license (MIT).
