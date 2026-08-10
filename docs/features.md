**[← Back to README](../README.md)**

# Feature Catalog

A complete inventory of Mycelium's user-facing behavior — one entry per
distinct capability, as a user story with its entry point, the invariants
it enforces, and whether it's covered by `test/`. This is a **living
document**: update the coverage marker whenever a test is added or a
behavior changes. It exists so that during architecture work, "is this the
intended behavior?" has a documented answer instead of relying on tribal
memory.

Coverage legend: ✅ tested · ⬜ untested · 🟡 partially tested.

---

## Capture (`src/scanner.js`)

- **Discover and import sessions.** `scan({ onImport })`. Skips excluded
  (soft-deleted) ids and unchanged files (`_mtimeMs` match). One-time
  migration normalizes stale `source: 'claude-code'` → `'claude'` on touch.
  Drops empty sessions and Mycelium's own meta-calls. On re-import, carries
  forward 13 downstream-owned fields (`extracted`, `folder`, `organizedBy`,
  lineage arrays, suggestion/classification bookkeeping, `titleLocked`,
  `summarizedTurnCount`) so capture never clobbers later-stage state. 🟡
  (`scan()`'s carry-forward + skip-unchanged + empty-session-drop behavior is
  tested against a fake adapter; the real per-adapter `parse()` paths are
  covered separately under Agents/Adapters)
- **Never re-capture Mycelium's own LLM calls.** `purgeMeta()` /
  `isMyceliumMeta()` — matches `META_MARKER` (current) or 7 legacy Korean
  prompt fragments (retroactive only). ✅ (marker path tested; legacy
  Korean-fragment fallback is not)
- **Raw record CRUD.** `loadRaw`/`saveRaw`/`deleteRaw`/`allRaw` — `loadRaw`
  never throws (null on missing/corrupt file). ✅
- **Look up a session by short id prefix.** `findSession(idOrPrefix)` —
  exact match wins; unique prefix match; ambiguous → up to 5 candidates
  listed; zero matches → error. ✅

## Organize — Folder tree (`src/organize.js`)

- **Create a folder.** `mkdir(folderPath)`. ✅
- **List the full tree** (including empty folders). `listTreeDirs()`. `_inbox`
  excluded (virtual); `_archive` present but hidden from default views. ⬜
- **Rename/re-nest a folder.** `renameFolder(oldPath, newPath)`. Rejects
  moving into self/a descendant. Rewrites `folder` prefix on every affected
  session (`organizedBy` preserved — structural move, not re-filing).
  **Special-cases case-only renames** on case-insensitive filesystems
  (macOS/Windows) via a temp-name two-step, to avoid deleting the source. ✅
  (including the case-only-rename branch — no longer the highest-risk
  untested function in the module)
- **Delete a folder.** `deleteFolder(folderPath, { reassignTo })` — sessions
  reassigned (default `_inbox`), never orphaned. ✅

## Organize — Manual session mutation (human-owned)

- **Move a session to a folder.** `move(sessionId, folderPath)` — sets
  `organizedBy: 'human'` (the sticky flag automation always respects). ✅
- **Edit tags manually.** `tag(sessionId, add, remove)` — also marks
  human-owned. ✅
- **Edit title/summary manually.** `setContent(sessionId, { title, summary })`
  — non-empty title → `titleLocked: true`; **clearing it to empty unlocks it
  again** so auto-tag refills it. Summary always refreshes regardless. ✅
- **Delete a session (Mycelium-only, original log untouched).**
  `deleteSession(sessionId)` — adds to `config.excludedSessionIds`
  (persistent tombstone); sweeps every other session's
  `continuedTo`/`mergedFrom`/`supersededBy`/`splitInto` to remove dangling
  backlinks; returns `touchedIds` for reindexing. ✅

## Organize — Smart-organize classification workflow (LLM)

- **Get + review + apply LLM folder placement suggestions.**
  `classificationCandidates`, `summarizeCandidates`, `suggestPlacements`,
  `queueSuggestions`, `pendingSuggestions`, `clearSuggestions`,
  `applyPlacements`. Candidacy = `organizedBy !== 'human'` only. Cooldown
  (`0` for explicit runs, 24h for the daemon) avoids re-asking the LLM about
  an unresolved session every cycle. `summarizeCandidates` batches by
  `concurrency` (default 3, deliberately low — see issue #3 history).
  `suggestPlacements` prefers a folder's `KNOWLEDGE.md` over raw summaries,
  chunks by `batchSize` (25), validates every returned folder path
  (`isSafeFolderPath`), flags `isNew` for folders that don't exist yet, and
  stamps `lastClassifiedAt` on every candidate seen **regardless of match
  outcome** (this is what makes the cooldown work). `applyPlacements` reuses
  `move()`. 🟡 (`classificationCandidates`, `queueSuggestions`,
  `pendingSuggestions`, `clearSuggestions`, `applyPlacements` — the
  non-LLM plumbing around the workflow — are untested; `summarizeCandidates`
  and `suggestPlacements` themselves call `complete()` and still need
  Phase 5's mocked-LLM tests)

## Organize — Lineage (continuation / merge / split)

- **Link a handoff's parent/child sessions.** `linkContinuation(childId, parentId)`
  — no-op if `childId === parentId`; dedupes. ✅
- **Fold a merge/split "product" into a real resumed session.**
  `foldProductIntoSession(productId, newId)` — prepends product's turns with
  a `role:'system'` provenance separator, unions `filesChanged`, deletes the
  product (backlink sweep applies). ⬜
- **Merge sessions (git-like, reversible).** `mergeSessions(ids, {title})` /
  `unmerge(mergedId)` — requires ≥2 valid ids; **originals never mutated**,
  only `supersededBy` set; sorted by `startedAt` before concatenating; each
  block gets a `role:'system'` separator turn. ✅

## Learn (`src/learn.js`)

- **Auto-generate title/summary/tags/decisions/todos.**
  `autoTagSession(sessionId, {existingTags})` — empty session → error, no
  LLM call. Title overwritten **only if `!titleLocked`**. Tags capped at 5.
  `summarizedTurnCount` recorded every run (growth-detection baseline).
  Prompt excerpt is 60%-head/40%-tail of a 6000-char cap, not a plain
  truncate. ⬜
- **Retroactive bulk (re-)tagging.** `tagAll({force, onProgress, limit})` —
  skip condition is "has summary AND hasn't grown since"; a session that
  grew is retagged even without `force`. `limit` caps per-call volume
  (issue #3 history — avoid outlasting the scan interval). ⬜

## Insight — Digests & folder knowledge (`src/insight.js`)

- **Generate a daily/weekly narrative digest.** `generateDigest({period, date})`
  — ISO week computation (Monday-based, UTC); no sessions for the period →
  error before any LLM call; overwrites any existing digest for that key. ⬜
- **Extract, preview, then save folder knowledge.** `buildKnowledgeText(folder)`
  (generate only, no write — split out for the TUI's human-confirm step),
  `writeKnowledgeText(folder, text)`, `extractKnowledge(folder)`
  (generate+write, non-interactive CLI path). Excludes superseded sessions
  from the LLM material. Prompt explicitly forbids meta-report phrasing
  since the output is injected verbatim into AGENTS.md later. ⬜
- **List which folders have sessions.** `foldersWithSessions()`. ⬜

## Reuse — Context inheritance (`src/reuse.js`)

- **Inherit ancestor-folder knowledge.** `assembleContext(folderPath)` —
  walks root→leaf, concatenating every ancestor's `KNOWLEDGE.md` that
  exists (missing ones silently skipped). ✅
- **Inject knowledge into a project's `AGENTS.md`.**
  `injectAgentsMd(targetDir, folderPath)` — **the riskiest write in the
  app: edits a file Mycelium doesn't own**, outside `~/.mycelium`. Only
  touches content between `<!-- mycelium:begin -->`/`<!-- mycelium:end -->`
  markers; replaces in place if present, appends (preserving existing
  content) if not; no-ops if no `KNOWLEDGE.md` exists in the ancestor path. ✅
  (including the repeated-call/no-duplication invariant — no longer the
  untested riskiest write in the app)
- **Preview what a session would inherit.** `contextForSession(sessionId)`. ✅

## Handoff (`src/handoff.js`)

- **Generate a cross-agent handoff prompt.** `buildHandoff(sessionId)` —
  composes original request, summary, files changed (capped 30), decisions,
  todos, last assistant message (capped 600 chars), inherited knowledge.
  Every optional section is omitted (not blanked) if empty. ✅ (inherited
  `assembleContext()` knowledge section itself covered separately under Reuse)

## Split (`src/split.js`)

- **Propose + apply LLM topic-boundary splits.**
  `suggestSplitBoundaries(sessionId)` (propose only) / `applySplit(sessionId, ranges)`
  (commit reviewed subset). Refuses sessions <4 turns. Every turn included
  in the prompt (indices must stay trustworthy for slicing), each truncated
  to 300 chars. Ranges validated (integer, in-bounds) before trusting.
  Pieces inherit `cwd`/`projectDir`/dates/`folder` from the original and are
  marked `organizedBy: 'human'`; **original is never hidden** (`splitInto`
  is informational only, unlike merge's hiding via `supersededBy`). 🟡
  (`applySplit`'s slicing/range-validation/piece-metadata is tested;
  `suggestSplitBoundaries` itself calls `complete()` and still needs
  Phase 5's mocked-LLM tests)
- **Undo a split.** `unsplit(originalId)` — only removes pieces whose
  `splitFrom === originalId` (defensive check). ✅

## Cleanup (`src/cleanup.js`)

- **Prune empty folders.** `pruneEmptyFolders()` — `_inbox`/`_archive`
  always protected. ✅
- **Bulk-delete `_archive`.** `clearArchive()`. ✅
- **Rebuild the sqlite index from scratch.** `rebuildIndex()`. ✅
- **One-shot safe tidy** (purge meta + prune folders + reindex). `tidy()`. ✅
- **Full destructive reset.** `resetStore()` — deletes `~/.mycelium`
  entirely (irreversible; original agent logs untouched). ✅

## Daemon / Background Upkeep (`src/daemon.js`)

- **Automatic scan/organize/digest cycles.** `runDaemon({log})` =
  `scanCycle` + `smartOrganizeCycle` + `digestCycle`. **Reentrancy guards**
  (`scanRunning`/`organizeRunning`) prevent overlapping ticks — the direct
  fix for the historical "20+ concurrent LLM processes" incident (issue #3).
  `smartOrganizeCycle` also refuses to run while a suggestion batch is
  already queued/unreviewed. `digestCycle` runs at most once per local
  calendar day, always for **yesterday**. Auto-apply vs. queue-for-review
  branches on `config.autoApproveSmartOrganize` (default `false`). Every
  cadence/limit is env-tunable (`MYCELIUM_SCAN_MS`,
  `MYCELIUM_SMART_ORGANIZE_MS`, `_LIMIT`, `_COOLDOWN_MS`,
  `MYCELIUM_TAG_BATCH_LIMIT`, `MYCELIUM_SUMMARIZE_CONCURRENCY`). ⬜
- **Run upkeep inside the TUI process (no separate daemon).**
  `startTuiRoutine()` — replaced an earlier detached-process design that
  kept running stale code across restarts. Opt-out via
  `MYCELIUM_NO_AUTOSTART`. ⬜
- **Explicit detached daemon** (`mycelium daemon --detach`/`--stop`).
  `spawnDetachedDaemon()`/`stopDetachedDaemon()` — idempotent via pidfile +
  liveness check. ⬜

## Agents / Adapters (`src/agents.js`, `src/adapters/*`)

- **See which agent CLIs are installed.** `which(cmd)` — PATH scan. ⬜
- **Resolve the right binary/args to resume a session.**
  `binFor(source)`/`resumeArgsFor(source, id)` — fall back to
  `claude`/`['--resume', id]` for an unrecognized source. ⬜
- **Resolve the correct working directory to resume in.**
  `workDirFor(session)` — prefers `projectDir` over `cwd`; `null` if neither
  path still exists on disk. ⬜
- **Get a copy-pasteable resume command.** `resumeCommandLine(session)` —
  checks the binary is installed, shell-quotes safely. ⬜
- **Adapter contract** (`src/adapters/base.js`, registry in `index.js`):
  every adapter exports `name` (== session `source`), `label`, `bin`,
  `newArgs`, `resumeArgs`, `listSessions()`, `parse(ref)`. ✅
- **Claude Code adapter** — parses `~/.claude/projects/*/*.jsonl`,
  recovers `projectDir` from the encoded folder name, tool activity as
  prose-only summaries (never raw payloads). 🟡 (parse tested; corrupt-line
  resilience and `filesChanged` regex not directly tested)
- **Codex adapter** — parses `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`.
  🟡 (parse tested; `session_meta` id-override case not tested)
- **Kiro adapter** — unions 3 on-disk formats (SQLite v1/v2, JSONL
  sidecar); v2 opened `readOnly: true` (never mutates the user's real DB).
  🟡 **(only the JSONL fallback is tested — the SQLite v1/v2 paths, which
  the module's own doc says are what's actually live, are untested)**

## Config & Paths (`src/config.js`, `src/paths.js`)

- **Persisted preferences with safe defaults.** `loadConfig()`/`saveConfig()`
  — merges `{...DEFAULTS, ...parsed}` (new defaults auto-backfill old
  files); corrupt JSON falls back to pure `DEFAULTS`, never throws. ✅
- **One overridable data home.** `HOME`/`RAW_DIR`/etc., `ensureDirs()`. ✅

## Index / Search (`src/index-db.js`)

- **Sqlite index rebuildable from raw files.** `reindex()` (full) /
  `reindexOne`/`reindexMany` (incremental) / `removeFromIndex()`. Schema
  migrations are additive `ALTER TABLE` (only `"duplicate column"` errors
  swallowed). 🟡 (exercised transitively via `cleanup.test.js`, not directly)
- **List/filter sessions.** `listSessions({folder, date, includeSuperseded})`
  — same 3-way folder-scope contract as elsewhere (undefined=all,
  null=unfiled, string=subtree); date matches `ended_at` falling back to
  `started_at` (last-activity, not creation). ✅
- **Full-text + tag + folder search.** `search(...)` — FTS5, bm25-ranked
  when a text query is given; tag filter is AND; query tokens individually
  quoted to survive punctuation/Korean text. ✅ (punctuation-safety asserted
  via "doesn't throw"; Korean-text tokenizing specifically not exercised)
- **Folder/calendar counts.** `folderCounts()`/`sessionCountsByDay(month)`
  — both exclude superseded sessions; day grouping uses the same
  last-activity basis as `listSessions`'s date filter. ✅
- **List all tags with usage counts.** `listTags()`. ✅

## LLM Provider (`src/llm.js`)

- **Run prompts through the user's own CLI subscription** (no separate API
  key). `complete(prompt, {timeoutMs})` — prepends `META_MARKER` (the
  signal `scanner.js` filters back out); provider selectable via
  `MYCELIUM_LLM`; `windowsHide: true` (issue #3); default 4-minute timeout,
  SIGTERM on expiry. 🟡 (the `__setTestProvider()` injection seam itself is
  tested; the real `claude`/`codex` spawn path is not, by design)
- **Normalize Claude/Codex's different stdout shapes.** `extractText(stdout)`
  — tries Claude's `{result}` JSON, falls back to scanning Codex JSONL for
  the last `agent_message` (both the `msg.type` and `payload.type` event
  shapes), falls back to raw trimmed text. Pure function, zero mocking
  needed. ✅
- **Parse a JSON reply out of prose/code-fences.** `parseJsonReply(text)` —
  extracts a ```` ```json ``` ```` fence if present, else finds first `{`/last
  `}`; returns `null` (never throws) on failure. **Known edge case**: text
  after the JSON containing its own braces mis-slices and returns `null`
  instead of the real object — pinned as a regression test, not yet fixed.
  Pure function, zero mocking needed. ✅

## CLI (`src/cli.js`) — see [`docs/cli.md`](./cli.md) for the full command reference

Every command funnels errors through one `fail(msg)` (`console.error` +
`exit 1`) except the unrecognized-command branch, which does its own
`process.exit(cmd?1:0)` — a latent dead-code oddity (unreachable `exit(0)`
since the no-command case is handled earlier and launches the TUI instead).
`cleanup archive` is equally destructive to `cleanup reset` but has no
`--yes` confirmation gate — a real safety inconsistency worth fixing.
Roughly a third of commands' output strings are hardcoded Korean,
independent of `mycelium lang` (which only affects the TUI) — worth a
decision before assuming the CLI is localized. None of the 25+ subcommands
are exercised through `cli.js`'s own dispatch layer today (the underlying
module functions they call are tested where noted above, but the CLI
argument-parsing/routing/output-formatting layer itself is not). ⬜

## TUI — App shell (`src/tui/app.js`, `index.js`)

- **Quit confirm** (`q`/`Ctrl-C`) — two-press confirm, guarded by an
  overridable `app.quitGuard` (the tutorial takes it over during its own
  run). ⬜
- **First-run onboarding prompt** — offers the interactive tutorial or a
  static overview; `config.onboarded` set on first answer either way. ⬜
- **Post-mount notification** — pending-suggestion toast takes priority
  over the unfiled-backlog hint. ⬜

## TUI — Detail rendering (`src/tui/render.js`)

- **Shared session-detail formatter.** `formatSessionDetail(n)` — title,
  source/date/folder, tags, summary bullets (falls back to first-user-turn
  preview when unsummarized), decisions/todos, continuation/merge/split
  lineage links (`?` placeholder when a linked session isn't in the store).
  One implementation, used by both the Sessions panel and the Calendar tab's
  detail panel. `splitSentences(text)` — sentence-boundary split for the
  summary bullets, no blessed dependency. ✅

## TUI — Folders panel (`src/tui/views/sessions.js`)

Live preview on navigate; `a` new subfolder; `e` rename (blocked on
Root/New); `m` move/re-nest; `x` delete (sessions reassigned to New, not
deleted); `w` extract KNOWLEDGE.md (shared with Sessions panel — async LLM
generate → dismiss toast → `confirmText` preview → conditional write, the
canonical "preview-then-confirm" pattern reused by `i` too). ⬜

## TUI — Sessions panel (`src/tui/views/sessions.js`)

Navigation (Enter/→ drill in, Esc/← back), multi-select (`Space`, `*`
select-scoped-all), `Shift+O` cycle sort, `Shift+M` merge (2+ selected,
git-like), `Shift+S` LLM split-review (multi-select, default unchecked —
opposite default from `o`'s multi-select), `/` search, `v` toggle Calendar
tab (co-hosted screen, `activeTab`-guarded key scoping — the largest
architectural coordination point in the file), `s` scan, `o` smart-organize
(largest/most stateful handler: cached-vs-fresh branch, two sequential LLM
phases, toast-dismiss race, multi-select review, always-clear-queue-on-close),
`?` help, `g` re-show onboarding, `m`/`t` move/tag, `x` delete (sweeps
backlinks across all targets), `n` launch new agent, `r` resume (falls back
to handoff for merge/split products), `h` handoff (post-launch folds a
merge/split product into the new real session), detail-panel `Enter`
resume-or-copy choice, `a` auto-tag (sequential batch with per-item
progress + partial-failure tolerance), `e` rename title, `y` copy to
clipboard, `d` digest reader (nested mini-screen), `c` view context, `i`
inject AGENTS.md (preview-then-confirm, sibling to `w`). ⬜

## TUI — Calendar tab (`src/tui/views/calendar.js`)

Month grid ↔ day list ↔ detail, same drill-down language as Sessions.
Grid left/right move the day cursor ±1 day and up/down ±1 week; both roll
into the adjacent month at the edges (moveDay uses Date arithmetic and
reloads that month's counts when the boundary is crossed). PgUp/PgDn jump a
whole month, keeping the same day-of-month. **`r`/`h`/detail-Enter are ~40 lines independently duplicated from
Sessions** — a deliberate, self-acknowledged choice by the original author
(comment explains resume/handoff churned enough that sharing felt riskier
at the time) — the clearest extraction candidate in the codebase. Tab
activate/deactivate preserves the calendar's own cursor position across
switches (lazy-created once, cheap to reactivate). ⬜

## TUI — Tutorial / `mycelium demo` (`src/tui/tutorial.js`, `tutorial-data.js`, `tutorial-mock-llm.js`)

**Highest state-machine complexity in the app.** Seeds 6 realistic mock
sessions (`demo: true`, unfiled); a narrator overlay runs its OWN
`app.screen.on('keypress', ...)` listener alongside (never wrapping)
sessions.js's real handlers, inferring "did a real action's modal open/close"
by polling `app.screen.children.length` against a captured baseline — a
generic heuristic that works because every picker/viewer in the codebase
parents itself to `app.screen`. 14-step script covering panel navigation
(← → between Folders/Sessions/Detail) then the full lifecycle — Organize
(`o`) → Learn (`w`) → Reuse (`c`) → session lineage (Shift+M merge,
Shift+S split) → freeform explore — mixing `waitFor`+`thenWait` (poll for a
real modal), plain `waitFor` (a literal key), a `shift: true` flag (blessed's
raw keypress reports Shift+M as `key.name: 'm'` + `key.shift: true`, not the
`'S-m'` combo-string form only `element.key()` bindings understand — the
merge/split steps need this to avoid matching a stray plain `m`/`s`),
`pollOnEntry` (the merge title-prompt step only — `blessed.prompt`'s Enter
submit doesn't reliably bubble a matching keypress to this screen-level
listener the way `blessed.list`-based widgets like `multiSelectList`/
`confirmText` do, so `waitFor: 'enter'` there silently never fired; this
step instead starts polling for close the moment it's entered, no keypress
match needed, found by walking the tutorial live end-to-end in tmux — not
something a unit test of the STEPS data would have caught), `freeform`
(steps where Escape passes through to real back-navigation instead of
aborting), and a `final` step with its own double-confirm. A
100ms Escape-debounce guards against split ESC-byte-plus-arrow-key sequences
(common over slow/tmux/SSH links) being misparsed as a standalone abort.
`app.quitGuard` is held for the tutorial's whole duration and released via
`setImmediate` (not synchronously) to dodge a same-physical-keypress race
with the global quit binding. `o`/`w`/Shift+S all call real LLM-bound
functions (`suggestPlacements`, `buildKnowledgeText`, `suggestSplitBoundaries`)
— `seedMockSessions()` swaps `llm.js`'s `complete()` over to
`tutorial-mock-llm.js`'s `tutorialMockProvider()` for as long as the mock
sessions exist (cleared in `endTutorial()`), so these resolve quickly and
deterministically instead of via a real `claude`/`codex` subprocess call.
`tutorialMockProvider()` still resolves after a deliberate ~5s delay
(`MOCK_DELAY_MS`, overridable via `MYCELIUM_DEMO_MOCK_DELAY_MS` — see
`test/tutorial-mock-llm.test.js`, which sets it to 30ms so the suite isn't
stuck waiting on it), not instantly — a 0ms response is its own regression,
since `app.js`'s animated spinner never gets a frame to actually animate
and the wait reads as "did that run at all?" rather than a real (much
faster) stand-in for the production wait. This is also what keeps the
tutorial's folder/knowledge
output in English
regardless of locale, since the real classification/knowledge prompts are
Korean by design (see `AGENT.md`) and would otherwise mirror that language
back for any newly-proposed folder name. 🟡 (`buildMockSessions()` and
`tutorial-mock-llm.js`'s prompt-dispatch/classification/folder-lookup logic
are unit-tested as pure functions — the interactive state machine itself has
zero coverage)

**TUI testability feasibility note (Phase 7 scope — investigation only, no
code changed).** `isModalOpen()` (`app.screen.children.length > baseline`)
is the one thing blocking the STEPS reducer above from being unit-tested
without blessed — the state machine's transitions themselves are plain data,
but every "did the real action's modal open/close" check goes through this
DOM-child-count heuristic instead of an explicit flag.

Promoting it to an explicit `app.modalDepth` counter (incremented on open,
decremented on close) would make the STEPS reducer testable in isolation,
but it isn't a localized change: every picker/prompt/viewer that currently
self-parents to `app.screen` — `pickFolder`, `editTags`, `menu`,
`multiSelectList`, `textPrompt`, `textView`, `digestReader`, `confirmText`,
`helpModal`, `welcomeModal` (all in `src/tui/widgets/`), plus every ad hoc
`blessed.box`/`.list` mounted directly in `sessions.js`/`calendar.js`/
`launch.js` — would need to increment/decrement it consistently, including
on every exit path (Escape, selection, programmatic dismiss). Miss one and
`isModalOpen()`'s current "did *anything* new get parented to the screen"
generality quietly breaks for just that one widget — a correctness
regression in the tutorial's own detection logic, not just a test-quality
concern. That's real, cross-cutting surgery with its own risk profile,
touching most of `src/tui/widgets/*` plus three view files — explicitly out
of scope for this refactor pass (the original plan scoped Phase 7 as
"investigate feasibility, execute separately," and this note is that
investigation). A follow-up plan should treat it as its own reviewed change,
not a rider on an unrelated refactor.

---

## Cross-cutting duplication (architecture revamp candidates)

1. ~~**Folder-subtree matching**~~ **FIXED** — was 5+ independent
   implementations of `folder===X || folder?.startsWith(X+'/')` across
   `organize.js`/`index-db.js`/`insight.js`. Extracted to
   `isInSubtree(sessionFolder, scopeFolder)` in `src/organize/folders.js`,
   re-exported through the `organize.js` barrel; `index-db.js`/`insight.js`
   import it the same way they already import `isArchive`.
2. ~~**Backlink-array cleanup on delete**~~ **CORRECTED, not extracted** —
   re-inspecting `deleteSession`/`unmerge`/`unsplit` directly (not just the
   original survey) found only `deleteSession` does a real full-store
   backlink **sweep** (checks every other session's `continuedTo`/
   `mergedFrom`/`supersededBy`/`splitInto`). `unmerge`/`unsplit` each clear a
   **single known field on specific already-known ids** — a materially
   different, thinner operation with no real logic to share with the sweep.
   No helper extracted; this entry stays only as a correction to the
   original survey.
3. ~~**"First real user turn" extraction**~~ **FIXED**, deliberate behavior
   change. `handoff.js`/`insight.js` used to bypass `schema.js:firstUserText()`
   with their own inline `turns.find(t => t.role === 'user')`. Split
   `firstUserText()` into `firstUserTurn()` (the untruncated turn — new
   export) + `firstUserText()` (200-char preview built on top of it), since
   calling `firstUserText()` directly would have also imposed its 200-char
   list-preview cap onto handoff's ~800-char excerpt and insight's ~80-char
   digest line — a bigger, unwanted change. Both callers now use
   `firstUserTurn()` and apply their own existing truncation, so a session
   whose first turn is a synthetic tag now surfaces the same real first
   message everywhere (handoff prompts, digests, session-list previews).
   Covered by `test/schema.test.js`, `test/handoff.test.js`, and an addition
   to `test/insight.test.js`.
4. ~~**Resume/handoff/copy trio**~~ **FIXED** — ~40 lines that were
   duplicated wholesale between `sessions.js` and `calendar.js`
   (self-acknowledged in a comment) extracted into
   `createResumeHandoff(app, {getCurrentRow, afterResume, afterHandoff})` in
   `src/tui/resume-handoff.js`. `getCurrentRow`/`afterResume`/`afterHandoff`
   stay as per-view parameters rather than being unified further: sessions.js's
   detail-triggered resume explicitly returns to the 'sessions' level while
   its handoff path doesn't (handoff is only ever bound from the list level
   there), a real pre-existing difference this extraction preserves rather
   than silently changes; calendar.js uses one shared `afterAction()` for
   both. Manually smoke-tested via tmux against the demo store (`mycelium
   demo`'s isolated `~/.mycelium-demo`) — `r`/`h`/detail-Enter all verified
   in both the Sessions panel and the Calendar tab's day-list/detail,
   including the real "Choose agent" picker and the "no work dir" resume
   guard, no crashes. No automated test coverage (blessed/TUI code, same as
   the rest of the TUI — see Phase 7 below).
5. **Live-preview-on-navigate** — the same arrow-key-preview idiom
   hand-copied 3×: folders panel, sessions list, calendar day list.
6. **LLM batching** — three different concurrency models across
   `learn.js`, `organize.js`'s two batch functions.
7. ~~**`organize.js` is a 595-line god-module**~~ **FIXED** — split into
   `src/organize/folders.js` (folder CRUD), `src/organize/classify.js` (the
   LLM classification workflow), `src/organize/lineage.js` (manual mutation
   + merge/split/continuation lineage), with `src/organize.js` kept as a
   barrel re-export (`export * from './organize/*.js'`) so every existing
   importer's `'../organize.js'` path is unchanged. Modeled on k9s's
   per-resource-type DAO split (`internal/dao`) — one small file per
   responsibility behind a stable import path, not a deep layered folder
   tree (kept flat, in the spirit of `agentmemory`-style local CLI tools).
8. ~~**`daemon.js` mixes** cycle/scheduling policy with OS process
   lifecycle~~ **FIXED** — split into `src/daemon/cycles.js` (scan/organize/
   digest cadence) and `src/daemon/process.js` (spawn/detach/pidfile), same
   barrel pattern as `organize.js`. Also dropped a dead
   `if (import.meta.url === ...) runDaemon()` bootstrap line — confirmed via
   grep that `daemon.js` is never executed directly.
9. **`llm.js` mixes** subprocess spawning with pure text utilities
   (`extractText`, `parseJsonReply`) that have zero dependency on it.
10. **`config.locale` is honored only by the TUI** — every LLM prompt in
    the core layer (`learn.js`, `insight.js`, `organize.js`, `split.js`) is
    hardcoded Korean regardless of locale setting.
