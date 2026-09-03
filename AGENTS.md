# AGENTS.md

Orientation for an AI coding agent (Claude Code, Codex, Cursor, or similar) working in this repository. If you're a human, [`README.md`](./README.md) and [`docs/`](./docs) are the better starting point — this file is dense and reference-oriented on purpose.

This follows the [AGENTS.md](https://agents.md) standard — read natively by Codex and other AGENTS.md-aware tools. **Claude Code does not read AGENTS.md on its own** (confirmed against Anthropic's own docs — it only ever auto-loads `CLAUDE.md`), so `CLAUDE.md` in this repo's root just imports this file via `@AGENTS.md`. That's also exactly the gap `src/reuse.js`'s `injectAgentsMd()` needs to account for when writing to a *target* project — see that file's own doc comment.

## What this tool is

Mycelium is a local-first Context Lifecycle TUI for AI coding-agent sessions. It manages context produced by AI collaboration through four stages — **Capture → Organize → Learn → Reuse** — implemented as a terminal UI (`neo-blessed`) plus a CLI, both reading/writing a plain-file store under `~/.mycelium/`.

## Why it exists

AI coding sessions (Claude Code, Codex, Kiro, OpenCode, ...) accumulate fast and lose context across three axes:
- **Model boundaries** — switching agents mid-task loses everything the previous agent knew (see Handoff below).
- **Time** — a session from three weeks ago is unfindable without search/organization.
- **Space** — nothing links related sessions across a project's lifetime unless something builds that structure.

Mycelium's answer: capture every session losslessly into a neutral schema, organize it (LLM-assisted, human-confirmed) into folders, learn from finished sessions (auto-summarize, extract project knowledge), and reuse that knowledge — injected into `AGENTS.md` for the next agent, or composed into a handoff prompt when switching agents mid-task. See [`docs/features.md`](./docs/features.md) for the full capability catalog and [`docs/architecture.md`](./docs/architecture.md) for design principles (local-only, model-agnostic, human-first, minimal dependencies).

## Repository layout

```
src/
  cli.js              CLI entry point (25+ subcommands) — see docs/cli.md
  paths.js            ~/.mycelium/* path constants; HOME resolved from MYCELIUM_HOME once at import time
  schema.js           the neutral session schema every adapter normalizes into
  scanner.js          Capture: import from each adapter, raw/ file CRUD
  organize.js         barrel — see src/organize/{folders,classify,lineage}.js
  daemon.js           barrel — see src/daemon/{cycles,process}.js
  learn.js            auto-tagging (title/summary/tags/decisions/todos) via an LLM call
  insight.js          digests + per-folder KNOWLEDGE.md generation
  reuse.js            KNOWLEDGE.md → AGENTS.md injection (ancestor-path inheritance)
  handoff.js          cross-agent handoff prompt composition
  backlog.js          user-written intent notes (kind: 'backlog'), opened as a seeded handoff
  split.js            LLM-suggested session splitting
  index-db.js         sqlite (FTS5) index — derived, rebuildable from raw/
  config.js           config.json read/write (locale, excluded ids, etc.)
  llm.js              headless LLM calls via the user's own claude/codex CLI subscription
  agents.js           derives binFor/resumeArgsFor from the adapter registry
  adapters/           one file per agent CLI (claude-code.js, codex.js, kiro.js) + index.js registry
  tui/                the neo-blessed interface — app.js (shell), views/ (sessions.js, calendar.js),
                       widgets/ (pickers.js, viewers.js), data.js (thin read layer over scanner+index-db),
                       tutorial.js + tutorial-data.js + tutorial-mock-llm.js + personas.js (first-run tour / `mycelium demo`)
docs/                 detailed guides (linked from README.md's "Learn More")
test/                 node:test suite — see "Tests" below
.github/              CI/CD workflows, issue/PR templates
```

### Architecture pattern: barrel modules, not deep layers

`organize.js` and `daemon.js` are **barrels**: `export * from './organize/*.js'` / `export * from './daemon/*.js'`. The implementation lives in sibling files split by responsibility (`organize/folders.js` = folder CRUD, `organize/classify.js` = LLM classification workflow, `organize/lineage.js` = manual mutation + merge/split/continuation; `daemon/cycles.js` = cadence/policy, `daemon/process.js` = OS process lifecycle), but every existing importer keeps using `'../organize.js'` / `'./daemon.js'` unchanged. This mirrors k9s's per-resource-type accessors behind a shared interface (`internal/dao`'s `Accessor`/`AccessorFor`) — the same shape as this repo's own `src/adapters/index.js` (`ADAPTERS` array + `getAdapter(source)`). **If you're adding new functionality to `organize.js`/`daemon.js`, add it to the right sibling file, not to the barrel.**

Keep this pattern flat, not deeply nested — no `services/`/`repositories/`/`controllers/` folder trees. One level of sibling files per god-module is the ceiling; if a sibling file itself grows past a few hundred lines with mixed concerns, that's the signal to split again, not to add another layer.

## Code conventions

- **No Prettier.** `eslint.config.js` is correctness-only (`no-unused-vars` with a `^_` ignore pattern for intentionally-unused params, plus `js.configs.recommended`). Match the surrounding file's hand-written style; don't reformat unrelated code.
- **No premature abstraction.** Don't extract a helper for a pattern that looks similar but isn't actually shared logic — this repo has an explicit example of *not* doing that: `deleteSession()`'s full-store backlink sweep vs. `unmerge()`/`unsplit()`'s single-field clears look similar but aren't the same operation, so no shared helper was extracted (see `docs/features.md`'s cross-cutting-duplication section, item 2, for the reasoning written out).
- **Comments explain WHY, not WHAT.** Default to no comments; add one only for a non-obvious constraint, invariant, or the reason behind a workaround. Read any existing comment in a file you're editing before assuming behavior — this codebase leans on comments to record hard-won bug history (e.g. issue #3's "20+ concurrent LLM processes" incident is referenced from `daemon.js`/`organize.js`/`learn.js` wherever a concurrency guard exists).
- **Human-facing text**: LLM prompts (in `learn.js`, `insight.js`, `organize.js`'s classification, `split.js`) and their expected JSON output follow `config.js`'s `contentLocale()` (`config.json`'s `locale` field, `'ko'` or else `'en'`) — the same locale `src/tui/i18n.js`'s `t()` already uses for UI chrome, so generated *content* (auto-tag titles/summaries, classification reasons, digests, KNOWLEDGE.md text, split labels) now matches whichever language a user has picked instead of always coming back Korean regardless. Two non-LLM-prompt call sites follow the exact same convention for the exact same reason (human-facing text a user reads/pastes, not chrome): `handoff.js`'s `buildHandoff()` (the seed prompt copied for the *next* agent) and `reuse.js`'s `injectAgentsMd()` (one marker comment inside the injected AGENTS.md block). Each of these keeps its original Korean text unchanged under the `'ko'` branch and adds an English one alongside it — not a translation layer, two maintained versions per call site. Switch locale via `mycelium lang <en|ko>`, the in-TUI `l` key, or the language picker shown on first launch / before every `mycelium demo` persona pick (see Key bindings below). Code identifiers, comments, README/docs, and commit messages are English regardless. The tutorial/`mycelium demo` never calls a real LLM (see Tests below) — `tutorial-mock-llm.js`'s mock dispatch/parsing branches on the same locale so its canned output stays consistent with what the real prompts would produce (`tui/personas.js`'s mock session content is fully bilingual, `{en, ko}` per field, not just the surrounding chrome).
- **Commit messages**: no enforced prefix convention (no `feat:`/`fix:`). Short subject line describing *what* changed, blank line, body explaining *why*. Look at `git log` for tone — some history is in Korean (predates this convention), but write new commit messages in English going forward.
- **Data-layer boundaries**: `raw/<id>.json` is the source of truth; `db/index.db` (sqlite/FTS5) is a derived, always-rebuildable index (`reindex()`/`mycelium cleanup index`). Never treat the index as authoritative — if a bug looks like a data-consistency issue, check whether `raw/` and the index have simply drifted.
- **`organizedBy: 'human'` is sticky.** Any code path that assigns a folder automatically must check this flag and never overwrite a human-placed session. This is the one invariant most of `organize.js`'s classification workflow exists to protect.

## Docs conventions

- `README.md` stays trimmed to Intro/Requirements/Install/Getting Started/Learn More/Cleanup/Contributing — anything more detailed belongs in `docs/`, linked from "Learn More."
- `docs/features.md` is a **living catalog**, not a one-time snapshot: every module's capabilities as "As a user, I can ___" stories with file:line references, invariants, and a coverage marker (`[tested]` / `[partial]` / `[untested]`). **When you add or change a capability, update its entry and coverage marker in the same change** — this file and the test suite are meant to track each other.
- Markdown prose is **not hard-wrapped** — one paragraph per source line, let the viewer soft-wrap. (Established after CLA.md/CONTRIBUTING.md were found hard-wrapped at ~80 cols while the rest of `docs/*.md` wasn't; un-wrapped to match the dominant convention. Code blocks and lists are unaffected either way.)

## Tests

`node:test` (Node's built-in runner, zero new dependency) — `npm test` runs everything under `test/` (unit + e2e). `npm run test:unit` runs only `test/*.test.js` (fast, seconds); `npm run test:e2e` runs only `test/e2e/*.test.js` (slower — real blessed screens against fake terminal streams, several seconds per test). CI (`.github/workflows/ci.yml`) runs these as two separate jobs so a unit-test failure surfaces immediately without waiting on the slower e2e job. No mocking framework; hand-written fakes/seams only. `npm run test:coverage` runs everything through Node's own `--experimental-test-coverage` (again zero new dependency) and writes `coverage/lcov.info`; `.github/workflows/coverage.yml` runs it on every push to `main` and feeds the result through `scripts/coverage-badge.js` to update the README's coverage badge (a Gist-hosted shields.io endpoint, via `GIST_SECRET`) — PRs don't trigger it, so the badge only moves once a change actually lands on `main`.

- **Pure functions** (`schema.js`, `render.js`'s `formatSessionDetail`/`splitSentences`, `llm.js`'s `extractText`/`parseJsonReply`, `config.js`): plain static `import`, no isolation needed.
- **Filesystem-backed modules**: `test/helpers.js`'s `useTempHome()` sets `process.env.MYCELIUM_HOME` to a fresh temp dir **before** any dynamic `import()` of a `paths.js`-dependent module — `paths.js`'s `HOME` constant is read once at module-load time, and `node --test` runs each test file in its own process, which is what makes per-file isolation actually work. Pattern:
  ```js
  import { useTempHome } from './helpers.js';
  useTempHome();
  const { thingUnderTest } = await import('../src/whatever.js'); // dynamic, not static
  ```
  A shared temp store persists across all tests **within one file** — tests that need exact counts scope themselves (e.g. via a `folder` parameter, or by cleaning up sessions they know would otherwise leak into a later unscoped call) rather than assuming a pristine store.
- **LLM-dependent modules** (`learn.js`, `insight.js`, `organize.js`'s classification, `split.js`'s boundary suggestion): `src/llm.js` exports `__setTestProvider(fn)`/`__clearTestProvider()` — an injection seam on `complete()`, used both by tests and (the one non-test caller) `tui/tutorial.js`'s `seedMockSessions(personaId)`/`endTutorial()`, via `tui/tutorial-mock-llm.js`'s `createTutorialMockProvider(personaId)`, so the first-run tutorial/`mycelium demo` never spawns a real subprocess. Mock content itself (which folders/keywords/knowledge each persona uses) lives in `tui/personas.js`, shared by `tutorial-data.js` and `tutorial-mock-llm.js`. Production path (real `claude`/`codex` subprocess) is untouched when no provider is set. Always `__clearTestProvider()` in `test.afterEach()`.
- **Never touch the real `~/.mycelium` store.** Every test file that touches the data layer must isolate via `useTempHome()`. When adding tests, verify the real store's session count is unchanged before/after a test run if you're unsure.
- Adapters intentionally read from the real `~/.claude`/`~/.codex`/`~/.kiro`/OpenCode's own `opencode.db` (see `src/adapters/index.js`'s `ADAPTERS`), not `MYCELIUM_HOME` — `scan()` tests that need deterministic counts temporarily splice `ADAPTERS`' contents down to fake adapters and restore the real ones in a `finally` (see `test/scanner.test.js`'s `withOnlyAdapters()`).
- **TUI/blessed code** (`src/tui/**`, beyond pure helpers like `render.js`) has one automated e2e layer: `test/e2e/demo-e2e.test.js` (run via `npm run test:e2e`, its own CI job — see Tests above), which drives the REAL `createApp()`/`sessionsView()`/`startTutorial()` handlers against fake `input`/`output` streams (`test/tui-helpers.js`'s `createTestApp()`/`sendKey()`) instead of a real TTY — no tmux, no pty. Real bytes on the input stream (not synthetic keypress objects) are required: `element.key()` bindings (every `screenKey()`/`listBox.key()` call in `sessions.js`) depend on a `program`-level `'key <name>'` event only emitted from real keypress parsing, which a bare `screen.emit('keypress', ...)` never reaches — see that file's module comment. It covers the organize→learn→reuse→merge→split flow and the tutorial's exit-key behavior; it does **not** assert rendered pixel/ANSI output (fragile, low value) — only real resulting state (session records, file contents, the `onDone(completed)` callback). Anything not covered by that suite (calendar, other pickers/viewers, general TUI polish) still has no automated coverage — verify manually (`node src/cli.js demo` against the isolated `~/.mycelium-demo` store is the safe way to interact with realistic data without touching anything real).

## Key bindings (TUI)

Full reference: [`docs/tui.md`](./docs/tui.md). Quick map, since a change to any of these keys touches `src/tui/views/sessions.js`/`calendar.js`:

| Stage | Keys |
|---|---|
| Capture | `s` scan |
| Organize | `m` move · `t` tag · `o` smart organize |
| Learn | `a` auto-tag/summarize · `w` extract folder knowledge · `k` review + inject knowledge updates across every active folder at once (unrelated to Digest/`d`) |
| Reuse | `n` new agent (asks: open here, or copy command for another tab) · `h` handoff · `r` resume · `i` inject AGENTS.md |
| Backlog | `b` write an item to start later · `r`/detail-`Enter` start it (seeded handoff) · `e` edit its title + notes |
| Navigation | `Enter`/`→` drill in · `Esc`/`←` back · `Space` multi-select · `/` search · `v` Calendar tab |
| Other | `Shift+M` merge · `Shift+S` split · `Shift+O` cycle sort · `y` copy · `d` digests · `g` re-show onboarding · `l` switch language (confirm, then restarts) · `?` full shortcut list · `q` quit |

`src/tui/resume-handoff.js`'s `createResumeHandoff()` is the shared implementation behind `r`/`h`/detail-`Enter` in **both** the Sessions panel and the Calendar tab — if you're changing resume/handoff behavior, change it there once, not in both views.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full workflow (fork → branch → change → lint/test → PR → CLA → review) and [`CLA.md`](./CLA.md) (draft, unreviewed by a lawyer — flag this if a contribution needs one). The one workflow worth knowing up front:

**Adding a new AI agent CLI** touches exactly two files: write `src/adapters/<name>.js` implementing the contract in `src/adapters/base.js` (`name`, `label`, `bin`, `newArgs(seed)`, `resumeArgs(sessionId)`, `listSessions()`, `parse(ref)` — `src/adapters/codex.js` is the simplest existing example), then register it in `src/adapters/index.js`'s `ADAPTERS` array. Scanning, resuming, launching, and the TUI's agent picker all derive from that one registry automatically. Add tests to `test/adapters.test.js` following the existing pattern (fixture transcript + `parse()` assertion).

## Drafting issues and PRs

Keep GitHub issue/PR bodies short — a few bullets, not prose paragraphs restating the diff or every file touched (that's what the diff itself is for). A PR body has already been trimmed once in this repo's history for being too verbose; match the trimmed version's density, not the original:

- **PR summary**: 2-4 bullets max. Each bullet is one change + its one-line reason, not a paragraph. Skip anything a reviewer can already see in the diff (file names, "added X function") unless it needs context the diff can't show (why, not what).
- **Checklist**: match `.github/PULL_REQUEST_TEMPLATE.md`'s heading (`## Checklist`, not `## Test plan`) — a short list of checkboxes (`- [x] npm test`, `- [x] npm run lint`, `- [ ] manual: ...`), not a narrative.
- **Issue bodies**: state the problem/request in 1-3 sentences plus repro steps or a code pointer if relevant. Don't restate the codebase context the maintainer already knows.
- When drafting via `gh pr create`/`gh issue create` (or editing after the fact via `gh api ... -X PATCH -f body=...` — `gh pr edit` can fail on this repo with an unrelated "Projects (classic)" GraphQL error, in which case fall back to `gh api`), write the concise version directly — don't draft long and plan to trim later.

## Before you finish a change

1. `npm run lint && npm test` — both must be clean.
2. If you touched a capability described in `docs/features.md`, update its entry/coverage marker.
3. If you touched TUI resume/handoff, folder-scope matching (`isInSubtree`), or classification logic, check whether the change is covered by existing tests in `test/organize.test.js`/`test/index-db.test.js`/`test/learn.test.js` — add a case if not.
4. Never run a destructive `mycelium cleanup reset`/`rm -rf ~/.mycelium` type command against the real store while verifying a change — use `mycelium demo` (isolated `~/.mycelium-demo`) or a temp `MYCELIUM_HOME` instead.
