**[← Back to README](../README.md)**

# Data Location, Design Principles, and Status

## Data Location

Everything is stored locally under `~/.mycelium/`. **Files are the source
of truth; sqlite is a derived index** (rebuild it any time with
`mycelium reindex` if it is ever deleted):

```
~/.mycelium/
  raw/<id>.json          normalized sessions (source of truth)
  tree/<folder>/         user folder structure = real directories
    KNOWLEDGE.md          per-folder project knowledge (the unit of inheritance)
  digests/YYYY-Wnn.md    narrative digests
  db/index.db            sqlite FTS5 search index (rebuildable)
  config.json            deletion list, display language (locale), etc.
```

To move sessions between machines, copy `raw/` and `tree/`, then run
`mycelium reindex` on the destination.

## Design Principles

- **Local-only**: sessions contain sensitive work, so nothing leaves the
  machine. The interface is a local terminal TUI; LLM calls go through
  your own CLI subscription.
- **Model-agnostic**: the storage format is a neutral schema, not any one
  vendor's session format. Adding a new agent means one adapter file (see
  [`CONTRIBUTING.md`](../CONTRIBUTING.md)).
- **Human-first**: automatic filing and tagging are only suggestions.
  Automation never overwrites a session a human has already organized
  (`organizedBy: human`).
- **Minimal dependencies**: the core uses only Node's built in modules
  (`node:sqlite`, etc.); the TUI adds exactly one dependency,
  `neo-blessed` (MIT). MIT licensed.

## Status

POC. All four lifecycle stages are verified against real local sessions
(Claude Code, Codex, Kiro, OpenCode). The TUI is built on neo-blessed and
is being verified in real terminal use.
