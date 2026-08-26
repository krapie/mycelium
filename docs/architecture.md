**[← Back to README](../README.md)**

# Data Location, Design Principles, and Status

## Data Location

Everything is stored locally under `~/.mycelium/` by default; set `MYCELIUM_HOME` to override that location. **Files are the source of truth; sqlite is a derived index** (rebuild it any time with `mycelium reindex` if it is ever deleted):

```text
~/.mycelium/
  raw/<id>.json          normalized sessions (source of truth)
  tree/<folder>/         user folder structure = real directories
    KNOWLEDGE.md          per-folder project knowledge (the unit of inheritance)
  digests/YYYY-Wnn.md    narrative digests
  db/index.db            sqlite FTS5 search index (rebuildable)
  config.json            deletion list, display language (locale), etc.
```

To move sessions between machines, copy `raw/` and `tree/`, then run `mycelium reindex` on the destination.

## Design Principles

- **Local-only**: sessions are stored only on the machine, never on a Mycelium-owned server. The interface is a local terminal TUI, but organize/autotag/knowledge calls do send selected session content to whichever CLI/provider you've configured (`claude`/`codex`), the same as any direct use of that CLI.
- **Model-agnostic**: the storage format is a neutral schema, not any one
  vendor's session format. Adding a new agent means one adapter file (see
  [`CONTRIBUTING.md`](../CONTRIBUTING.md)).
- **Human-first**: automatic filing and tagging are only suggestions.
  Automation never overwrites a session a human has already organized
  (`organizedBy: human`).
- **Minimal dependencies**: the core uses only Node's built in modules
  (`node:sqlite`, etc.); the TUI adds exactly one dependency,
  `neo-blessed` (MIT). MIT licensed.

## Core API Boundary

Every lifecycle operation lives in one small set of core modules under `src/`, independent of any particular interface. Two interfaces exist today — the TUI (`src/tui/`) and the CLI (`src/cli.js` + `src/cli/*.js`) — and both are thin callers over the same core, never a second home for business logic. A future interface (a GUI, per issue [#38](https://github.com/krapie/mycelium/issues/38); a headless HTTP API) is expected to be a third thin caller over the exact same modules, not a reason to duplicate or relocate any of this.

**Core** (data mutation, LLM prompt construction/parsing, classification rules, schema normalization — no rendering, no argv parsing):

- `schema.js` — the neutral session schema every adapter normalizes into.
- `paths.js` — `~/.mycelium/*` path constants.
- `scanner.js` — Capture: adapter import, `raw/` file CRUD.
- `organize.js` (barrel → `organize/{folders,classify,lineage}.js`) — folder CRUD, LLM classification, merge/split/continuation lineage.
- `learn.js` — auto-tagging (title/summary/tags/decisions/todos).
- `insight.js` (barrel → `insight/{digest,knowledge}.js`) — digests and per-folder `KNOWLEDGE.md` generation/review.
- `split.js` — LLM-suggested session splitting.
- `reuse.js` — `KNOWLEDGE.md` → `AGENTS.md` injection.
- `handoff.js` — cross-agent handoff prompt composition.
- `index-db.js` — sqlite (FTS5) search index, derived and rebuildable from `raw/`.
- `config.js` — `config.json` read/write (locale, excluded ids, etc.).
- `llm.js` — headless LLM calls via the user's own `claude`/`codex` CLI subscription.
- `agents.js`, `adapters/*.js` — the agent-CLI registry (`binFor`/`resumeArgsFor`, per-adapter `parse()`).
- `daemon.js` (barrel → `daemon/{cycles,process.js}`) — background cadence over the modules above; a scheduler, not a fourth interface.

**Interface** (parse input → call core → render/format output, and nothing else):

- `src/tui/` — `views/sessions.js` wires widgets and key bindings, delegating the actual work to `views/sessions-actions.js`'s 7 handlers (`doScan`/`doOrganize`/`doRefreshKnowledge`/`doMerge`/`doSplit`/`doKnowledge`/`doNewAgent`, each a function over an explicit `ctx`) and `resume-handoff.js`'s shared `doResume`/`doHandoff`; `tutorial.js`'s `startTutorial()` delegates its step-walking state machine to `tutorial-runner.js` the same way. This shape — a thin per-interaction handler taking explicit params/`ctx`, calling straight into core, then rendering — is what Phase 2 (issue [#88](https://github.com/krapie/mycelium/issues/88)) made structurally uniform across the TUI, and is the shape a GUI's own handlers are expected to take too.
- `src/cli.js` + `src/cli/*.js` — `cli.js` is dispatch only (argv → a `COMMANDS` table); each `src/cli/*.js` sibling (`capture.js`/`organize.js`/`learn.js`/`reuse.js`/`find.js`/`cleanup.js`/`run.js`) is a thin per-command wrapper over the same core calls the TUI makes, formatting output as plain text/console logs instead of blessed widgets.

**Where the boundary isn't perfectly clean yet**: a few TUI action handlers (`sessions-actions.js`'s `runSmartOrganize()`/`runKnowledgeReview()`) build blessed markup (`{${C.fox}-fg}...{/}`) directly into a review item's `label` string, rather than having the core call return plain data and the interface layer format it separately — harmless today (only the TUI reads these), but a GUI or API layer reusing `suggestPlacements()`/`pendingKnowledgeReviews()` directly (bypassing the TUI action handler entirely, calling the core module itself) sidesteps this cleanly, since the markup only exists in the TUI-side wrapper, not in the core function's own return value.

## Status

POC. All four lifecycle stages are verified against real local sessions (Claude Code, Codex, Kiro, OpenCode). The TUI is built on neo-blessed and is being verified in real terminal use.
