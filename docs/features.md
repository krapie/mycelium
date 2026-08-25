**[← Back to README](../README.md)**

# Feature Catalog

A complete inventory of Mycelium's user-facing behavior, one entry per distinct capability, as a user story with its entry point, the invariants it enforces, and whether it's covered by `test/`. This is a **living document**: update the coverage marker whenever a test is added or a behavior changes. It exists so that during architecture work, "is this the intended behavior?" has a documented answer instead of relying on tribal memory.

Coverage legend: `[tested]` · `[untested]` · `[partial]` (partially tested).

---

## Capture (`src/scanner.js`)

- **Discover and import sessions.** `scan({ onImport })`. Skips excluded
  (soft-deleted) ids and unchanged files (`_mtimeMs` match). One-time
  migration normalizes stale `source: 'claude-code'` to `'claude'` on
  touch. Drops empty sessions and Mycelium's own meta-calls. On
  re-import, carries forward 13 downstream-owned fields (`extracted`,
  `folder`, `organizedBy`, lineage arrays, suggestion/classification
  bookkeeping, `titleLocked`, `summarizedTurnCount`) so capture never
  clobbers later-stage state. [partial] (`scan()`'s carry-forward,
  skip-unchanged, and empty-session-drop behavior is tested against a
  fake adapter; the real per-adapter `parse()` paths are covered
  separately under Agents/Adapters)
- **Auto-archive an old backlog on first capture.** `scan()` files a
  *newly discovered* session whose last activity (`endedAt`||`startedAt`)
  is older than `config.archiveOlderThanDays` (default 90, `<=0`
  disables) straight into `_archive` instead of New/unfiled, so a heavy
  first scan of thousands of historical sessions doesn't present as
  thousands of things to triage. Lossless (still stored and searchable);
  gated on `!existing` (first import only), `folder==null`, and
  non-human, so it never retroactively moves sessions already sitting in
  New. `_archive` is already hidden from New/Root/calendar and skipped by
  `o`/`a` (`classificationCandidates()` excludes it unless scoped into
  it; `tagAll()` skips it). [tested]
- **Re-apply the archive threshold to the existing backlog.**
  `reevaluateArchive({ days })` (CLI: `mycelium archive reeval [--days N]`).
  `scan()`'s archiving is first-import-only, so changing
  `archiveOlderThanDays` has no retroactive effect on its own; this
  reconciliation pass does. Bidirectional, auto-owned and New/`_archive`
  sessions only: a session now inside the window returns to New, one now
  past it gets archived; human placements and real-folder sessions are
  never touched. `--days` also persists as the new default threshold.
  [tested]
- **Never re-capture Mycelium's own LLM calls.** `purgeMeta()` /
  `isMyceliumMeta()`, matches `META_MARKER` (current) or 7 legacy Korean
  prompt fragments (retroactive only). [tested] (marker path tested;
  legacy Korean-fragment fallback is not)
- **Raw record CRUD.** `loadRaw`/`saveRaw`/`deleteRaw`/`allRaw`.
  `loadRaw` never throws (null on missing/corrupt file). [tested]
- **Look up a session by short id prefix.** `findSession(idOrPrefix)`.
  Exact match wins; unique prefix match; ambiguous returns up to 5
  candidates; zero matches errors. [tested]

## Organize: Folder tree (`src/organize.js`)

- **Create a folder.** `mkdir(folderPath)`. [tested]
- **List the full tree** (including empty folders). `listTreeDirs()`.
  `_inbox` excluded (virtual); `_archive` present but hidden from
  default views. [untested]
- **Rename/re-nest a folder.** `renameFolder(oldPath, newPath)`. Rejects
  moving into self or a descendant. Rewrites the `folder` prefix on
  every affected session (`organizedBy` preserved, a structural move,
  not re-filing). **Special-cases case-only renames** on case-insensitive
  filesystems (macOS/Windows) via a temp-name two-step, to avoid deleting
  the source. [tested] (including the case-only-rename branch, no longer
  the highest-risk untested function in the module)
- **Delete a folder.** `deleteFolder(folderPath, { reassignTo })`.
  Sessions reassigned (default `_inbox`), never orphaned. [tested]

## Organize: Manual session mutation (human-owned)

- **Move a session to a folder.** `move(sessionId, folderPath)`. Sets
  `organizedBy: 'human'`, the sticky flag automation always respects.
  [tested]
- **Edit tags manually.** `tag(sessionId, add, remove)`. Also marks
  human-owned. [tested]
- **Edit title/summary manually.** `setContent(sessionId, { title, summary })`.
  A non-empty title sets `titleLocked: true`; clearing it to empty
  unlocks it again so auto-tag refills it. Summary always refreshes
  regardless. [tested]
- **Delete a session (Mycelium-only, original log untouched).**
  `deleteSession(sessionId)`. Adds to `config.excludedSessionIds`
  (persistent tombstone); sweeps every other session's
  `continuedTo`/`mergedFrom`/`supersededBy`/`splitInto` to remove
  dangling backlinks; returns `touchedIds` for reindexing. [tested]

## Organize: Smart-organize classification workflow (LLM)

- **Get, review, and apply LLM folder placement suggestions.**
  `classificationCandidates`, `summarizeCandidates`, `suggestPlacements`,
  `queueSuggestions`, `pendingSuggestions`, `clearSuggestions`,
  `applyPlacements`. Candidacy is `organizedBy !== 'human'` only.
  Cooldown (`0` for explicit runs, 24h for the daemon) avoids re-asking
  the LLM about an unresolved session every cycle. `summarizeCandidates`
  batches by `concurrency` (default 3, deliberately low, see issue #3
  history) and takes a `limit` too (oldest-first, same as
  `suggestPlacements`), since a large first-time backlog otherwise means
  that many real LLM calls in one call, easily enough to exhaust a
  tighter usage quota mid-run (real report: "session 100% usage" against
  ~70 unfiled sessions). The TUI's `o` handler passes
  `SUMMARIZE_BATCH_LIMIT` (`sessions.js`, default 30,
  `MYCELIUM_SUMMARIZE_BATCH_LIMIT`-overridable); pressing `o` again picks
  up where it left off, since already-summarized candidates are
  excluded. `suggestPlacements` prefers a folder's `KNOWLEDGE.md` over
  raw summaries, chunks by `batchSize` (25), validates every returned
  folder path (`isSafeFolderPath`), flags `isNew` for folders that don't
  exist yet, and stamps `lastClassifiedAt` on every candidate seen
  **regardless of match outcome** (this is what makes the cooldown
  work). A chunk failure used to discard every other chunk's
  already-computed placements wholesale (`{ok:false}` even when most
  chunks succeeded); fixed to return `{ok:true, placements, error}`
  (partial success) whenever at least one placement came back,
  `{ok:false}` only when nothing useful did. Both functions, plus
  `tagAll` (`learn.js`), now pass `stopAfterConsecutiveFailures` (default
  3) to `mapConcurrent()` (`llm.js`), a circuit breaker that stops
  scheduling new work once that many calls fail in a row (real usage
  exhaustion makes every subsequent call fail identically) instead of
  burning through the rest of a large backlog one doomed subprocess at a
  time. Each function reports `stoppedEarly` so callers can distinguish
  "ran out of quota, stop here" from "some unrelated one-off failures."
  Per-candidate/per-chunk progress is written to disk as it completes
  either way, so stopping early never loses prior work. `applyPlacements`
  reuses `move()`. [tested] (`test/organize.test.js`/`test/learn.test.js`
  cover `summarizeCandidates`/`suggestPlacements`/`tagAll` via `llm.js`'s
  `__setTestProvider()` seam, including `limit`, the partial-success
  return shape, and the circuit breaker; `test/llm.test.js` covers
  `mapConcurrent()`'s breaker directly.
  `classificationCandidates`/`queueSuggestions`/`pendingSuggestions`/
  `clearSuggestions`/`applyPlacements`, the non-LLM plumbing, are also
  covered)

## Organize: Lineage (continuation / merge / split)

- **Link a handoff's parent/child sessions.**
  `linkContinuation(childId, parentId)`. No-op if `childId === parentId`;
  dedupes. [tested]
- **Fold a merge/split "product" into a real resumed session.**
  `foldProductIntoSession(productId, newId)`. Prepends the product's
  turns with a `role:'system'` provenance separator, unions
  `filesChanged`, deletes the product (backlink sweep applies).
  [untested]
- **Merge sessions (git-like, reversible).** `mergeSessions(ids, {title})` /
  `unmerge(mergedId)`. Requires 2 or more valid ids; **originals never
  mutated**, only `supersededBy` set; sorted by `startedAt` before
  concatenating; each block gets a `role:'system'` separator turn.
  [tested]

## Learn (`src/learn.js`)

- **Auto-generate title/summary/tags/decisions/todos.**
  `autoTagSession(sessionId, {existingTags})`. An empty session errors,
  no LLM call. Title overwritten **only if `!titleLocked`**. Tags capped
  at 5. `summarizedTurnCount` recorded every run (growth-detection
  baseline). Prompt excerpt is 60% head / 40% tail of a 6000-char cap,
  not a plain truncate. [untested]
- **Retroactive bulk (re-)tagging.**
  `tagAll({force, onProgress, limit, concurrency, stopAfterConsecutiveFailures})`.
  Skip condition is "has summary and hasn't grown since"; a session that
  grew is retagged even without `force`. `limit` caps per-call volume
  (issue #3 history, avoid outlasting the scan interval).
  `stopAfterConsecutiveFailures` (default 3) is the same circuit breaker
  as `organize.js`'s `summarizeCandidates`/`suggestPlacements`, see that
  entry above. [tested] (`test/learn.test.js`)

## Insight: Digests and folder knowledge (`src/insight.js`)

- **Generate a daily/weekly narrative digest.** `generateDigest({period, date})`.
  ISO week computation (Monday-based, UTC); no sessions for the period
  errors before any LLM call; overwrites any existing digest for that
  key. [untested]
- **Extract, preview, then save folder knowledge.** `buildKnowledgeText(folder)`
  (generate only, no write, split out for the TUI's human-confirm step),
  `writeKnowledgeText(folder, text)`, `extractKnowledge(folder)`
  (generate and write, non-interactive CLI path). Excludes superseded
  sessions from the LLM material. Prompt explicitly forbids meta-report
  phrasing since the output is injected verbatim into AGENTS.md later.
  [untested]
- **List which folders have sessions.** `foldersWithSessions()`. [untested]
- **Knowledge-refresh proposals, staged for review, a separate feature
  from Digest above despite living in the same file.**
  `foldersActiveOn(date)` (filed folders, unfiled/`_inbox` excluded,
  with a session that started that day; shares its day-filter with
  `generateDigest()` via an internal `sessionsForPeriod()` helper,
  purely to avoid a second copy of that filter, the two features are
  otherwise unrelated). `writePendingKnowledgeText(folder, text)` stages
  a proposal at `KNOWLEDGE.pending.md`, next to (not overwriting) the
  real `KNOWLEDGE.md`. `pendingKnowledgeReviews()` lists every folder
  currently carrying one. `promoteKnowledge(folder)` writes it as the
  real `KNOWLEDGE.md` (via `writeKnowledgeText()`) and clears the
  pending file; `dismissPendingKnowledge(folder)` clears it without
  promoting. Either way the folder stops being returned by
  `pendingKnowledgeReviews()`. The pending file's mere existence *is*
  the review queue, no separate store, the same "plain file is the
  state" shape as `organize/classify.js`'s session-level
  `suggestedFolder` queue, just folder-scoped.
  `proposeKnowledgeRefreshes(date, {concurrency, limit})` orchestrates
  the above for every active folder on `date`, skipping one with an
  existing unreviewed proposal; `concurrency`/`limit` default from
  `MYCELIUM_SUMMARIZE_CONCURRENCY`/`MYCELIUM_DIGEST_KNOWLEDGE_LIMIT` so
  every caller shares the same issue-#3 safety ceiling without each
  reimplementing it. Two callers, both wanting identical behavior: the
  TUI's `k` command (`sessions.js`), computing fresh for *today* the
  instant a human presses it (the expected, primary path), and the
  daemon's independent `knowledgeReviewCycle` (below), computing for
  *yesterday* once a day as the fallback for whenever a human didn't.
  Sharing one function rather than each having its own copy is what
  makes "did a human trigger this, or did Mycelium do it overnight"
  produce an identical result either way. [tested]

## Reuse: Context inheritance (`src/reuse.js`)

- **Inherit ancestor-folder knowledge.** `assembleContext(folderPath)`.
  Walks root to leaf, concatenating every ancestor's `KNOWLEDGE.md` that
  exists (missing ones silently skipped). Refuses a `folderPath` with `..`
  segments (`isSafeFolderPath()`, `paths.js`) rather than letting the
  `TREE_DIR` join escape outside it and read an arbitrary file — found via
  CodeRabbit review on #91; the same unguarded join pattern still exists
  in `organize/folders.js`'s folder CRUD and `insight.js`'s KNOWLEDGE.md
  writers, tracked separately (issue #92) rather than fixed here since it
  touches CLI/TUI error-handling contracts in more files than this PR's
  scope. [tested]
- **Inject knowledge into a project's `AGENTS.md`.**
  `injectAgentsMd(targetDir, folderPath)`. **The riskiest write in the
  app: edits a file Mycelium doesn't own**, outside `~/.mycelium`. Only
  touches content between `<!-- mycelium:begin:<folder> -->`/
  `<!-- mycelium:end:<folder> -->` markers, one block per folder rather
  than one per file (issue #90 — a directory hosting sessions from two
  different folders, e.g. a monorepo root, used to have the second
  inject silently discard whatever the first folder had already
  written); replaces in place if that folder's own block is present,
  appends a new block (preserving existing content, including any other
  folder's own block) if not; a pre-fix unscoped block is migrated to the
  new format on first inject rather than left orphaned; no-ops if no
  `KNOWLEDGE.md` exists in the ancestor path. The one marker comment
  Mycelium itself writes (not quoted from a `KNOWLEDGE.md`) follows
  `contentLocale()` too. [tested] (repeated-call/no-duplication,
  multi-folder-same-directory, and legacy-block-migration all covered)
- **`CLAUDE.md` bridge, so Claude Code actually sees any of this.**
  `injectAgentsMd()` also unconditionally calls `ensureClaudeBridge(targetDir)`,
  confirmed against Anthropic's own current docs that **Claude Code does
  not read `AGENTS.md` natively** (it only ever auto-loads `CLAUDE.md`),
  so writing `AGENTS.md` alone silently did nothing for a Claude Code
  session. Codex needs no bridge (walks up the tree for `AGENTS.md`,
  plus a global `~/.codex/AGENTS.md`); Kiro treats a root `AGENTS.md` as
  steering context, though a still-open upstream bug
  (`kirodotdev/Kiro#6755`) means it's sometimes listed as loaded without
  actually being read, not something Mycelium can work around from its
  side. OpenCode also needs no bridge: confirmed against opencode.ai's
  own docs and the installed v1.18.20, it reads `AGENTS.md` natively by
  walking up the directory tree, with `CLAUDE.md` only as its own
  lower-priority fallback, not re-verified against any other OpenCode
  release. The bridge is one line (`@AGENTS.md`), idempotent (checks for
  that substring first, so repeat injects never duplicate it), and
  additive, prepended ahead of whatever a real `CLAUDE.md` already has,
  never rewriting it. Unconditional rather than gated on which agent is
  about to launch: cheap and harmless for Codex/Kiro/OpenCode users, and
  covers manual `i`-key inject, which doesn't know the target agent up
  front. [tested] (fresh-create, prepend-without-touching-existing-content,
  and no-duplication-on-repeat all covered in `test/reuse.test.js`, same
  pattern as `AGENTS.md`'s own marker-block tests)
- **Preview what a session would inherit.** `contextForSession(sessionId)`. [tested]
- **Distinct existing working directories a folder's sessions have used.**
  `dirsForFolder(folder)`. Moved here from `tui/launch.js` (which still
  uses it for `n`'s directory picker) so `daemon/cycles.js`'s
  digest-review auto-inject can use it too, without core importing from
  `tui/**`. Filters to directories that still `existsSync()`. [tested]

## Handoff (`src/handoff.js`)

- **Generate a cross-agent handoff prompt.** `buildHandoff(sessionId, locale =
  contentLocale())`. Composes original request, summary, files changed
  (capped 30), decisions, todos, last assistant message (capped 600
  chars), inherited knowledge. Every optional section is omitted (not
  blanked) if empty. Follows `config.js`'s `contentLocale()` (AGENTS.md's
  "Human-facing text" convention), this human-facing seed prompt for the
  *next* agent matches whichever locale the user picked instead of
  always coming back Korean. [tested] (inherited `assembleContext()`
  knowledge section itself covered separately under Reuse)

## Split (`src/split.js`)

- **Propose and apply LLM topic-boundary splits.**
  `suggestSplitBoundaries(sessionId)` (propose only) / `applySplit(sessionId, ranges)`
  (commit reviewed subset). Refuses sessions with fewer than 4 turns.
  Every turn included in the prompt (indices must stay trustworthy for
  slicing), each truncated to 300 chars. Ranges validated (integer,
  in-bounds) before trusting. Pieces inherit `cwd`/`projectDir`/dates/
  `folder` from the original and are marked `organizedBy: 'human'`;
  **original is never hidden** (`splitInto` is informational only,
  unlike merge's hiding via `supersededBy`). [partial] (`applySplit`'s
  slicing/range-validation/piece-metadata is tested; `suggestSplitBoundaries`
  itself calls `complete()` and still needs mocked-LLM tests)
- **Undo a split.** `unsplit(originalId)`. Only removes pieces whose
  `splitFrom === originalId` (defensive check). [tested]

## Cleanup (`src/cleanup.js`)

- **Prune empty folders.** `pruneEmptyFolders()`. `_inbox`/`_archive`
  always protected. [tested]
- **Bulk-delete `_archive`.** `clearArchive()`. [tested]
- **Rebuild the sqlite index from scratch.** `rebuildIndex()`. [tested]
- **One-shot safe tidy** (purge meta, prune folders, reindex). `tidy()`. [tested]
- **Full destructive reset.** `resetStore()`. Deletes `~/.mycelium`
  entirely (irreversible; original agent logs untouched). [tested]

## Daemon / Background Upkeep (`src/daemon.js`)

- **Automatic scan/organize/digest/knowledge-review cycles.** `runDaemon({log})`
  equals `scanCycle` + `smartOrganizeCycle` + `digestCycle` +
  `knowledgeReviewCycle`. **Reentrancy guards**
  (`scanRunning`/`organizeRunning`) prevent overlapping ticks, the
  direct fix for the historical "20+ concurrent LLM processes" incident
  (issue #3). `smartOrganizeCycle` also refuses to run while a
  suggestion batch is already queued/unreviewed. `digestCycle`/
  `knowledgeReviewCycle` each run at most once per local calendar day,
  always for **yesterday**, two genuinely independent cycles (own
  `lastDigestDay`/`lastKnowledgeReviewDay` gates), not one calling the
  other; see the dedicated entry below for why Knowledge Review isn't
  digest-coupled. Auto-apply vs. queue-for-review branches on
  `config.autoApproveSmartOrganize` (default `false`). Every cadence and
  limit is env-tunable (`MYCELIUM_SCAN_MS`, `MYCELIUM_SMART_ORGANIZE_MS`,
  `_LIMIT`, `_COOLDOWN_MS`, `MYCELIUM_TAG_BATCH_LIMIT`,
  `MYCELIUM_SUMMARIZE_CONCURRENCY`, `MYCELIUM_DIGEST_KNOWLEDGE_LIMIT`).
  [partial] (`scanCycle`/`smartOrganizeCycle` themselves still untested;
  `digestCycle`/`knowledgeReviewCycle`'s own first-run orchestration is
  covered in `test/daemon-cycles.test.js`, detailed per-folder scenario
  coverage lives in `test/insight.test.js` against
  `proposeKnowledgeRefreshes()` directly)
- **`knowledgeReviewCycle` is independent of Digest, the daemon-side
  fallback for the TUI's `k` command.** `knowledgeReviewCycle(log)` calls
  `insight.js`'s `proposeKnowledgeRefreshes(yesterday)`, the exact same
  function `k` calls for *today* the moment a human presses it (see the
  TUI Sessions panel entry below), so whichever one actually ran
  produces an identical result. Deliberately a *separate* cycle and gate
  from `digestCycle`, not called from or calling it: an earlier version
  of this feature stapled the knowledge-proposal step onto `digestCycle`
  itself, which broke the moment a human manually generated *today's*
  digest via `n` (see Insight's own digestReader entry above), a path
  that never went through `digestCycle` at all, so the manual and
  automatic paths silently produced different results despite being "the
  same trigger, sort of." Splitting them, and moving the shared logic to
  `insight.js`, called identically by both, fixed that for good. [tested]
  (`test/daemon-cycles.test.js`)
- **Run upkeep inside the TUI process (no separate daemon).**
  `startTuiRoutine()`. Replaced an earlier detached-process design that
  kept running stale code across restarts. Opt out via
  `MYCELIUM_NO_AUTOSTART`. [untested]
- **Explicit detached daemon** (`mycelium daemon --detach`/`--stop`).
  `spawnDetachedDaemon()`/`stopDetachedDaemon()`. Idempotent via pidfile
  and liveness check. [untested]

## Agents / Adapters (`src/agents.js`, `src/adapters/*`)

- **See which agent CLIs are installed.** `which(cmd)`. PATH scan. [untested]
- **Resolve the right binary/args to resume a session.**
  `binFor(source)`/`resumeArgsFor(source, id)`. Falls back to
  `claude`/`['--resume', id]` for an unrecognized source. [untested]
- **Resolve the correct working directory to resume in.**
  `workDirFor(session)`. Prefers `projectDir` over `cwd`; `null` if
  neither path still exists on disk. [untested]
- **Get a copy-pasteable resume command.** `resumeCommandLine(session)`.
  Checks the binary is installed, shell-quotes safely. [untested]
- **Adapter contract** (`src/adapters/base.js`, registry in `index.js`):
  every adapter exports `name` (== session `source`), `label`, `bin`,
  `newArgs`, `resumeArgs`, `listSessions()`, `parse(ref)`. [tested]
- **Claude Code adapter.** Parses `~/.claude/projects/*/*.jsonl`,
  recovers `projectDir` from the encoded folder name, tool activity as
  prose-only summaries (never raw payloads). [partial] (parse tested,
  corrupt-line resilience and `filesChanged` regex not directly tested)
- **Codex adapter.** Parses `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`.
  [partial] (parse tested; `session_meta` id-override case not tested)
- **Kiro adapter.** Unions 3 on-disk formats (SQLite v1/v2, JSONL
  sidecar); v2 opened `readOnly: true` (never mutates the user's real
  DB). [partial] (only the JSONL fallback is tested; the SQLite v1/v2
  paths, which the module's own doc says are what's actually live, are
  untested)
- **OpenCode adapter.** Reads `~/.local/share/opencode/opencode.db`
  (SQLite, `XDG_DATA_HOME`-aware, `OPENCODE_SQLITE_DB` override), opened
  `readOnly: true` (never mutates the user's real DB); joins
  `session`/`message`/`part` tables, tool activity as prose-only
  summaries (never raw tool output or payloads). [partial] (`parse()`
  tested against a constructed SQLite fixture; `listSessions()`'s live
  default-DB-path resolution is untested, matching the same gap already
  noted for Kiro's SQLite paths)

## Config & Paths (`src/config.js`, `src/paths.js`)

- **Persisted preferences with safe defaults.** `loadConfig()`/`saveConfig()`.
  Merges `{...DEFAULTS, ...parsed}` (new defaults auto-backfill old
  files); corrupt JSON falls back to pure `DEFAULTS`, never throws. [tested]
- **One overridable data home.** `HOME`/`RAW_DIR`/etc., `ensureDirs()`. [tested]

## Index / Search (`src/index-db.js`)

- **Sqlite index rebuildable from raw files.** `reindex()` (full) /
  `reindexOne`/`reindexMany` (incremental) / `removeFromIndex()`. Schema
  migrations are additive `ALTER TABLE` (only `"duplicate column"`
  errors swallowed). [partial] (exercised transitively via
  `cleanup.test.js`, not directly)
- **List/filter sessions.** `listSessions({folder, date, includeSuperseded})`.
  Same 3-way folder-scope contract as elsewhere (undefined = all, null =
  unfiled, string = subtree); date matches `ended_at` falling back to
  `started_at` (last-activity, not creation). [tested]
- **Full-text + tag + folder search.** `search(...)`. FTS5, bm25-ranked
  when a text query is given; tag filter is AND; query tokens
  individually quoted to survive punctuation/Korean text. [tested]
  (punctuation-safety asserted via "doesn't throw"; Korean-text
  tokenizing specifically not exercised)
- **Folder/calendar counts.** `folderCounts()`/`sessionCountsByDay(month)`.
  Both exclude superseded sessions; day grouping uses the same
  last-activity basis as `listSessions`'s date filter. [tested]
- **List all tags with usage counts.** `listTags()`. [tested]

## LLM Provider (`src/llm.js`)

- **Run prompts through the user's own CLI subscription** (no separate
  API key). `complete(prompt, {timeoutMs})`. Prepends `META_MARKER` (the
  signal `scanner.js` filters back out); provider selectable via
  `MYCELIUM_LLM`; `windowsHide: true` (issue #3); default 4-minute
  timeout, SIGTERM on expiry. [partial] (the `__setTestProvider()`
  injection seam itself is tested; the real `claude`/`codex` spawn path
  is not, by design)
- **Normalize Claude/Codex's different stdout shapes.** `extractText(stdout)`.
  Tries Claude's `{result}` JSON, falls back to scanning Codex JSONL for
  the last `agent_message` (both the `msg.type` and `payload.type` event
  shapes), falls back to raw trimmed text. Pure function, zero mocking
  needed. [tested]
- **Parse a JSON reply out of prose/code-fences.** `parseJsonReply(text)`.
  Extracts a ```` ```json ``` ```` fence if present, else finds first
  `{`/last `}`; returns `null` (never throws) on failure. **Known edge
  case**: text after the JSON containing its own braces mis-slices and
  returns `null` instead of the real object, pinned as a regression
  test, not yet fixed. Pure function, zero mocking needed. [tested]
- **Bounded concurrency + optional circuit breaker for LLM-bound batches.**
  `mapConcurrent(items, concurrency, worker, {stopAfterConsecutiveFailures})`.
  The one place every LLM-bound batch caller (`summarizeCandidates`,
  `suggestPlacements`, `tagAll`, the TUI's multi-select auto-tag) gets
  its "how many `claude`/`codex` subprocesses at once" behavior from
  (issue #3). Returns `{results, stoppedEarly}` (changed from a bare
  `results` array; no caller read the return value before this, so the
  shape change is invisible to all of them). `stopAfterConsecutiveFailures`,
  when passed, requires `worker` to return `{ok}` and stops scheduling
  new items once that many fail in a row (a success resets the count);
  omitted (every pre-existing caller), `worker`'s return value isn't
  inspected at all, a pure no-op, unchanged behavior. Deliberately not
  string-matching a specific vendor error message (fragile, differs
  between `claude`/`codex`, changes across CLI versions): a run of
  consecutive failures, regardless of cause, is itself the signal a real
  usage-limit exhaustion is happening. [tested] (`test/llm.test.js`)

## CLI (`src/cli.js`), see [`docs/cli.md`](./cli.md) for the full command reference

Every command funnels errors through one `fail(msg)` (`console.error` + `exit 1`) except the unrecognized-command branch, which does its own `process.exit(cmd?1:0)`, a latent dead-code oddity (unreachable `exit(0)` since the no-command case is handled earlier and launches the TUI instead). `cleanup archive` is equally destructive to `cleanup reset` but has no `--yes` confirmation gate, a real safety inconsistency worth fixing. Roughly a third of commands' output strings are hardcoded Korean, independent of `mycelium lang` (which only affects the TUI), worth a decision before assuming the CLI is localized. Aside from `--version` (below), none of the 25+ subcommands are exercised through `cli.js`'s own dispatch layer today (the underlying module functions they call are tested where noted above, but the CLI argument-parsing/routing/output-formatting layer itself is not). [untested]

- **`--version` / `-v` / `-V`.** Prints `mycelium v<version>` and exits
  0, reading `src/version.js`'s `VERSION` (parsed once from
  `package.json` via a `file:` URL relative to that module, so it
  resolves correctly through symlinks regardless of install method: npm
  global, Homebrew, or a `npm link` dev checkout). Checked ahead of both
  the `!cmd`/`tui` TUI-launch branch and the switch's `default`
  fallthrough, unlike `--help` (documented above/in the Homebrew
  formula's own comments as falling into that `default` branch and
  exiting 1); this is a real, intentionally-handled flag. Same `VERSION`
  constant is shown right-aligned in the main TUI's statusbar
  (`app.js`'s `setStatus()`, same `{|}` right-align fill token
  `setHeader()` already uses for its own right-side counts), visible on
  every screen, not just the `?` help modal, and not locale-branched in
  `i18n.js` since a product name plus semver reads the same in `en`/`ko`.
  [tested] (`test/cli-version.test.js` spawns the real bin for all three
  flag forms; `test/version.test.js` covers `VERSION` itself)

## TUI: App shell (`src/tui/app.js`, `index.js`)

- **Quit confirm** (`q`/`Ctrl-C`). Two-press confirm, guarded by an
  overridable `app.quitGuard` (the tutorial takes it over during its own
  run). [untested]
- **First-run onboarding prompt.** Offers the interactive tutorial or a
  static overview; `config.onboarded` set on first answer either way.
  `runTui()`'s call to `daemon.js`'s `startTuiRoutine()` (real background
  `scanCycle()`, unawaited) is deliberately deferred until onboarding
  actually concludes (tutorial completed/declined, or not a first launch
  at all). A real bug in v0.1.0 called it unconditionally before this
  check, so it raced the tutorial's own mock-session seeding on a brand
  new install and could show real `~/.claude`/`~/.codex`/`~/.kiro`/
  OpenCode session titles mixed into what's supposed to be an isolated
  tutorial. [untested]
- **Onboarding-tutorial completion drops back to Sessions even if the
  human ended on the Calendar tab.** The `!cfg.onboarded` branch's
  `startTutorial()` callback resets the real cockpit via
  `sessionsView()`'s own `api.resetToRoot()` rather than a second
  `app.show()`/mount (see that method's own comment for why remounting
  is unsafe here). A real bug: if `v` was pressed during the tutorial and
  never toggled back before the final step's `q`, the old
  `resetToRoot()` only reset Sessions' own state; Calendar's boxes
  (`sessions.js`'s `calTab`) stayed active and visible, but
  `resetToRoot()`'s own `foldersBox.focus()` yanked blessed's real
  keyboard focus onto the still-hidden Sessions panel underneath. Every
  subsequent keypress was delivered to that invisible widget, nothing on
  screen responded, which read as stuck on Calendar with a modal that
  wouldn't close (the same root cause, not two separate symptoms).
  Fixed by having `resetToRoot()` mirror `showSessionsTab()`'s own
  tab-exit steps (deactivate `calTab`, show Sessions' three panels,
  `updateHeader()`) before its existing reset, whenever
  `activeTab === 'calendar'`. [tested] (`test/e2e/demo-e2e.test.js`'s
  "resetToRoot() while still on the Calendar tab..." asserts
  `app.body.children`'s real hidden state and `screen.focused` land back
  on the now-visible Folders panel, not a hidden one; confirmed to fail
  without the fix)
- **Post-mount notification.** Pending-suggestion toast takes priority
  over the pending-knowledge-review toast, which takes priority over the
  unfiled-backlog hint. Below `FIRST_SCAN_MODAL_THRESHOLD` (20) unfiled
  sessions, that last one is the original lightweight
  `sessions.unfiledHint` toast; at or above it, `notifyPostMount()`
  promotes to `firstScanModal()` (`widgets/viewers.js`) instead, since a
  real first scan can mean minutes of classification once `o` is
  pressed, a spinner-only toast undersells it. Guidance: press `o`, it
  takes real time for a backlog this size, feel free to switch away and
  come back to review, plus a tip pointing at the existing `Space`
  (multi-select) and `x` (delete) keys as a way to shrink the backlog
  before organizing, framed as fewer sessions meaning fewer LLM calls
  (no new mechanism, both keys already exist and work at Root scope
  across the whole unfiled list). Gated on `config.json`'s
  `firstScanModalShown` so it only ever shows once, ever, even across
  restarts. [partial] (`test/e2e/onboarding-e2e.test.js` covers
  `firstScanModal()` itself: content, Enter/Escape dismiss, `onDismiss`
  firing; `notifyPostMount()`'s own threshold/gating branch that decides
  when to show it is untested, verify manually)
- **Post-mount notification re-evaluates itself once the first real scan
  actually lands.** `startTuiRoutine()`'s own `scanCycle()` is
  fire-and-forget (see above). On a genuinely fresh store, a
  `startTuiRoutine()` call site that mounted `sessionsView()` and called
  `notifyPostMount()` before that first scan had imported anything used
  to read 0 sessions, with the `firstScanModal()` threshold check never
  clearing that launch, a real bug confirmed via VHS against a genuinely
  empty `~/.mycelium`. Fixed with `startTuiRoutine(onFirstScanDone)`
  (threaded through `daemon/process.js` to `daemon/cycles.js`'s
  `runDaemon()`, fired once, right after the first `scanCycle()`).
  `tui/index.js`'s shared `startUpkeepAndRecheck(getApi)` helper wraps
  this (`getApi()?.reloadAll()` plus a second `notifyPostMount()` call
  once real data exists) and is used at all three of `runTui()`'s
  `startTuiRoutine()` call sites (accepted-tour, declined-tour,
  already-onboarded). A follow-up fix moved the `onScanned` hook into
  `scanCycle()` itself (`daemon/cycles.js`), firing right after
  `reindex()` and before `tagAll()` starts, because the first version
  waited for `scanCycle()`'s full body including `tagAll()`, up to
  `TAG_BATCH_LIMIT` (20) real LLM calls, so the modal's numbers and the
  sessions view's own header/folders/list disagreed for that whole
  window. `tui/index.js` also gained a belt-and-suspenders explicit
  `api.reloadAll()` alongside its existing immediate `notifyPostMount()`
  call. [tested] (`daemon-cycles.test.js` covers `runDaemon()`'s
  `onFirstScanDone` firing exactly once and the `onScanned` hook firing
  while `tagAll()`'s own call is still pending; the `tui/index.js` wiring
  verified manually via VHS at all three call sites)
- **Real progress bar for the two smart-organize phases.**
  `app.startProgressBar(label)`. Sibling to `startSpinner()`, same
  `{update(current, total), stop()}` shape, backed by a real
  `blessed.progressbar` (`.setProgress(percent)`) instead of an
  animated-but-fake spinner frame. `sessions.js`'s `runSmartOrganize()`
  swaps its two `startSpinner` calls (summarize phase, placement phase)
  to this; both already track a true total up front, exactly what a
  filling bar needs and a spinner can't show. Other `startSpinner`
  callers (`w`, `k`, merge/split summarize) are untouched, they don't
  have a meaningful total. [partial] (`test/e2e/onboarding-e2e.test.js`
  covers `app.startProgressBar()` itself: real `.filled` percentage,
  label text, stop() hiding it; the `runSmartOrganize()` call sites are
  exercised indirectly by demo-e2e.test.js's `o` steps, which only
  assert the resulting review modal opens, not the bar's fill)
- **Shared toast (`startSpinner()`/`startProgressBar()`) is
  reference-counted, not last-write-wins.** Both share one `busyWidgets`
  counter; a real bug found in production had each `stop()` call
  `toast.hide()` (or `progressBox.hide()`) unconditionally, regardless of
  whether the other widget-type's own call was still active. Two
  overlapping `startSpinner()` calls meant whichever finished first hid
  the toast for both, reading as "the modal closed early" while the
  other's real work kept running. Fixed with a shared
  `hideToastIfIdle()` helper both `stop()` methods call, only actually
  hiding `toast` once `busyWidgets` reaches 0. [tested] (`test/e2e/
  spinner-toast-e2e.test.js`, two overlapping spinners, the common
  single-spinner case, and spinner+progress-bar sharing the counter)
  **Follow-up fix, same investigation, the actual dominant cause.** A
  real (non-mocked) solo merge, no second spinner involved, showed the
  "Summarizing…" toast invisible for the entire real duration of a
  `claude` call. Root cause: `neo-blessed`'s own
  `Message.prototype.display()` schedules an internal `setTimeout` that
  hides the toast unconditionally once its `seconds` argument elapses,
  and never clears that timeout on any later call. Fixed by having
  `tick()` (already running every 120ms) call `toast.show()` on every
  frame, decisively overriding any stale hide within 120ms; the earlier
  `rearm` workaround was removed as no longer needed. [tested] (existing
  `spinner-toast-e2e.test.js` cases pass unchanged; manually re-verified
  via a real, non-mocked merge, the toast now stays visible continuously
  for the operation's whole real duration)
- **In-flight LLM subprocesses are killed on quit, not orphaned.**
  `llm.js`'s `complete()` had no `detached` flag and nothing tracked its
  spawned child beyond the local Promise closure. `app.js`'s `quit()`
  (`screen.destroy(); process.exit(code);`, shared by both the `q` key
  and `Ctrl+C`) is unconditional and synchronous, so any
  `claude`/`codex` subprocess still running at quit time kept running as
  an orphan after mycelium itself had exited: real API quota consumed,
  an eventual write to `raw/<id>.json` with nothing left alive to show
  for it. Reported as "sessions still running even after exiting
  mycelium." Fixed with an `inFlight` `Set` (`llm.js`) every
  `complete()` call adds itself to on spawn and removes itself from on
  `close`/`error`, plus `killInFlight()`, a best-effort `SIGTERM` to
  everything currently tracked, not awaited. `app.js`'s `quit()` calls it
  before `process.exit()`. [tested] (`llm.test.js`, using test-only
  `__trackChildForTest()`/`__inFlightCountForTest()` seams; the real
  spawn path always targets the real `claude`/`codex` binaries, and
  `_testProvider` bypasses `spawn()` entirely, so neither can exercise
  real child tracking, the wiring inside `complete()` itself is left to
  code review)

## TUI: Detail rendering (`src/tui/render.js`)

- **Shared session-detail formatter.** `formatSessionDetail(n)`. Title,
  source/date/folder, tags, summary bullets (falls back to
  first-user-turn preview when unsummarized), decisions/todos,
  continuation/merge/split lineage links (`?` placeholder when a linked
  session isn't in the store). One implementation, used by both the
  Sessions panel and the Calendar tab's detail panel.
  `splitSentences(text)`, sentence-boundary split for the summary
  bullets, no blessed dependency. [tested]
- **Full session id, shown here now instead of the list** (issue
  [#57](https://github.com/krapie/mycelium/issues/57)). The Sessions
  list row used to carry a truncated `#<8-char>` badge
  (`sessions.js`'s `reloadList()`), rarely what you're scanning a list
  for, and it crowded the row's right-hand metadata cluster. Removed
  from the list entirely; `formatSessionDetail()` now prints the
  session's own id **in full** right under the source/date/folder line,
  the id wasn't shown anywhere in the TUI before this, needed for
  `mycelium resume <id>`/`mycelium context <id>` or filing a bug report.
  [tested] (`test/render.test.js` asserts the full id string, not a
  sliced prefix)

## TUI: Folders panel (`src/tui/views/sessions.js`)

Live preview on navigate; `a` new subfolder; `e` rename (blocked on Root/New); `m` move/re-nest; `x` delete (sessions reassigned to New, not deleted); `w` extract KNOWLEDGE.md (shared with Sessions panel: async LLM generate, dismiss toast, `confirmText` preview, conditional write, the canonical preview-then-confirm pattern reused by `i` too). [untested]

- **Navigating onto a folder whose sibling shares its leaf name no
  longer relocates the cursor to that sibling.** A real bug: two folders
  under different parents with the same leaf (e.g. `cases/CW` and
  `projects/CW`) render byte-identical rows in `reloadFolders()`
  whenever neither is the current one. `previewFolder()`'s live-preview
  calls `reloadFolders()` then `setItems()` on every up/down keystroke,
  and neo-blessed's own `List.prototype.setItems()` tries to keep the
  cursor on "the same item" across that full replacement by matching the
  previously selected row's rendered text against the new items array, a
  content match, not an index one. The instant the cursor moved onto one
  of two identically-rendered same-leaf folders, that heuristic could
  match the old text against the other one and silently relocate the
  real selection there. Fixed by capturing the intended index before
  `setItems()` and re-asserting it right after, unconditionally
  overriding blessed's own guess. [tested] (`test/e2e/folders-panel-e2e.test.js`,
  confirmed to fail on `main` before the fix, reproducing the exact
  cases/CW to projects/CW relocation, plus a real rename proving only
  the intended folder is ever affected)

## TUI: Sessions panel (`src/tui/views/sessions.js`)

Navigation (Enter/→ drill in, Esc/← back), multi-select (`Space`, `*` select-scoped-all), `Shift+O` cycle sort, `Shift+T` pick sort directly (see below), `Shift+M` merge (2+ selected, git-like), `Shift+S` LLM split-review (multi-select, default unchecked, opposite default from `o`'s multi-select), `/` search, `v` toggle Calendar tab (co-hosted screen, `activeTab`-guarded key scoping, the largest architectural coordination point in the file), `s` scan, `o` smart-organize (largest/most stateful handler: cached-vs-fresh branch, two sequential LLM phases, toast-dismiss race, multi-select review, always-clear-queue-on-close), `?` help, `g` re-show onboarding, `m`/`t` move/tag, `x` delete (sweeps backlinks across all targets), `n` launch new agent (open-here-or-copy choice, see below), `r` resume (falls back to handoff for merge/split products), `h` handoff (post-launch folds a merge/split product into the new real session), detail-panel `Enter` resume-or-copy choice, `a` auto-tag (sequential batch with per-item progress and partial-failure tolerance), `e` rename title, `y` copy to clipboard, `d` digest reader (nested mini-screen, plain narrative summary, no knowledge coupling, see `k` below), `k` knowledge review (see below), `c` view context, `i` inject AGENTS.md (preview-then-confirm, sibling to `w`). [untested]

- **`Shift+T`: pick a sort order directly, instead of `Shift+O`'s blind
  cycle** (issue [#51](https://github.com/krapie/mycelium/issues/51)).
  Opens `menu()` (`widgets/pickers.js`) with all 4 orderable
  combinations, newest/oldest first, title A→Z/Z→A, writing values in
  the same `state.sortBy` field `Shift+O`'s `SORT_CYCLE` already uses.
  The picker shares `title` and adds `title-desc`, `date-asc`, and
  `date-desc`; `Shift+O` remains unchanged and is still the only way to
  reach `agent` sort. `sortRows()` gained three comparators that didn't
  exist yet: `title-desc` (flipped `title` compare), `date-asc` (a real
  ascending sort), and `date-desc` (a real descending sort). The
  picker's "Newest first" option deliberately uses `date-desc`, not
  `Shift+O`'s `recent`; `recent` is a bare pass-through of whatever
  `data.sessions()` already returned, which is FTS relevance order while
  a search is active, not date order, so reusing it would have made
  "Newest first" silently mean "whatever order was already on screen"
  mid-search. [tested] (`test/e2e/sessions-sort-e2e.test.js`, all 4
  options via real keypresses against a fixture where title/date-asc/
  date-desc/agent orders are all distinct permutations; a dedicated case
  confirms "Newest first" still means literal date order with a search
  active, unlike `recent`; Escape leaves the order untouched)
- **`reloadList()` preserves session identity across a rebuild, not just
  numeric position** (real bug, found by CodeRabbit review on PR #58,
  same class as `reloadFolders()`'s own fix above). Two sessions can
  render byte-identical Sessions-panel rows; `setItems()` (neo-blessed)
  restores the cursor by matching the previously selected row's rendered
  text against the new items, a content match, not an identity one, so
  it could silently select the wrong one of two identical-looking rows.
  Worse than `reloadFolders()`'s version: `reloadList()` runs after
  nearly every mutation (rename, tag, move, delete, merge, split,
  auto-tag), several of which can also resort the list, so restoring by
  the old numeric index alone isn't sufficient here. Fixed by tracking
  the actually-selected session's `id` across the rebuild
  (`rows.findIndex((r) => r.id === wantId)`) instead of trusting either
  blessed's own heuristic or a bare index. [tested]
  (`test/e2e/sessions-list-duplicate-rows-e2e.test.js`, confirmed to
  fail on the pre-fix code, reproducing the exact wrong-session
  selection)
- **`k`: knowledge review, deliberately unrelated to Digest (`d`),
  mirrors `o` (smart organize) exactly, not the digest reader.**
  `runKnowledgeReview()`: reuse whatever `insight.js`'s
  `pendingKnowledgeReviews()` already has (fast path, the daemon's
  independent `knowledgeReviewCycle` may have already computed it
  overnight), else compute fresh for *today* via
  `proposeKnowledgeRefreshes()` with a spinner. Either way opens the
  same `multiSelectList` review `o` uses, all pre-checked, `Enter`
  applies, `Esc`/unchecking dismisses. Approving a folder writes its
  KNOWLEDGE.md (`promoteKnowledge()`), that's the content decision, kept
  separate from which directories actually receive it. Reworked into its
  own top-level command from an earlier version nested inside the
  digest reader, since the two features have nothing to do with each
  other. [tested] (`test/e2e/demo-e2e.test.js`'s `k (queued path)`/`k
  (fresh path)`)
- **`applyKnowledgeApprovals()`: a folder's directories are a second,
  separate decision from approving its knowledge.**
  `dirsForFolder(folder)` returns every distinct directory *any* session
  in that folder happened to run in, which isn't the same as "the
  project's directory." A folder groups by content topic, not by repo:
  a one-off question asked from an unrelated repo's terminal still gets
  classified into the real project's folder if the content matches, so
  `dirsForFolder()` can return a real project directory and an unrelated
  one side by side. The original version injected into all of them
  unconditionally on approval, silently writing AGENTS.md into
  directories that had nothing to do with the actual project (found via
  a real user's store). Fixed by splitting the decision: 0 or 1
  directory injects straight through (no ambiguity, same trust level as
  before); 2 or more opens a second `multiSelectList` (all pre-checked)
  so a directory that doesn't belong can be unchecked before anything is
  written, mirroring `n`'s own directory picker (`launch.js`'s
  `resolveDir()`). [tested] (`test/e2e/demo-e2e.test.js`'s "a folder
  spanning 2+ real directories asks which ones to inject into")
- **`multiSelectList`'s optional `previewText`, and `p` inside the
  knowledge review, the actual `confirmText()` checkpoint the review
  checklist was missing.** The checklist's own item label truncates to
  about 60 chars, nowhere near enough to actually judge content bound
  for a real project's AGENTS.md; `k`'s review let a folder get approved
  (and injected) on the strength of a one-line snippet alone.
  `multiSelectList(app, label, items, cb, { previewText })`
  (`widgets/pickers.js`) is a generic, opt-in addition: `p` opens a full
  scrollable `textView` of `previewText(currentItem.value)` for
  whichever row is highlighted, closes back to the still-live checklist
  on `p`/`q`/`Escape` again. Only `k`'s folder-approval checklist wires
  it up (`sessions.js`). [tested] (`test/e2e/demo-e2e.test.js`'s "p
  opens a full preview...")
- **`n`: one flow for launching a new session, either here or as a
  copyable command, no separate `Shift+N` keybinding.**
  `launchAgent()`'s agent-picker to directory-picker is followed by a
  third choice, "open here" or "copy command," the exact same shape
  `resume-handoff.js`'s `onDetailEnter()` already offers for resuming an
  existing session (same `resume.openHere`/`resume.copyCommand` i18n
  strings, reused rather than duplicated). "Open here" hands the
  terminal over to the child agent process via `foreground()`
  (`spawn(..., {stdio: 'inherit'})`), the same tty, blocking the whole
  TUI until that one session exits. "Copy command" instead builds a
  `cd <dir> && <bin> <args>` line (`agents.js`'s `newCommandLine()`) and
  copies it to the clipboard, paste into as many separate terminal tabs
  as you want, since there's no portable way for a terminal app to open
  a genuinely new tab or window across terminal emulators. Both branches
  run `injectAgentsMd()` first, skipping it on the copy path just
  because it doesn't itself launch anything would silently degrade
  whatever gets pasted. [untested]

The directory picker (`resolveDir()`) **creates the chosen directory** (`mkdir -p`, after a confirm menu) instead of aborting when it doesn't exist, since handing a session off into a fresh workspace is a first-class flow: the whole point of `h`/`n` is to seed the next agent's dir with the folder's KNOWLEDGE via `injectAgentsMd()`, and that dir often doesn't exist yet. Handoff (`resume-handoff.js`'s `doHandoff()`) also **prefills the picker with the handed-off session's own `projectDir`/`cwd`** (`launchAgent({defaultDir})`) rather than the mycelium process cwd, and offers that path even if it no longer exists (`resolveDir()` will offer to recreate it). [untested]
- **`.`: a "what do you want to do?" action palette.** `openActionMenu()`
  (`sessions.js`) opens a menu of the common session actions, each label
  showing its own single-key shortcut so the menu doubles as a way to
  learn the keys without memorizing them up front. **Grouped by scope**
  under non-selectable `SESSION`/`FOLDER` headers (a small `menu()`
  widget extension: a choice with `header: true` renders dimmed/indented
  and is skipped on select) so it's clear which actions act on the
  selected session (handoff, details, split, merge) vs. the folder or
  view you're browsing (scan, organize, insights, new task). Context
  aware: the SESSION group only appears when something's selected
  (Merge needs 2+; handoff/details/split need a current row).
  Deliberately excludes actions that are neither: Digest (`d`, global
  and date-based) and Refresh-knowledge (`k`, a review inbox for the
  daemon's prepared updates, scoped to *today's* active folders) stay on
  their own keys. Every entry's value is the *exact same handler* its
  key triggers (`doScan`/`doOrganize`/`doMerge`/`doSplit`/`doHandoff`/
  `doNewAgent`/`doKnowledge`/`drillIntoDetail`), so the key and the menu
  can't drift. [tested] (smoke e2e: opens on `.`, closes cleanly on Esc,
  input not wedged, `test/e2e/demo-e2e.test.js`; FOLDER group's exact
  item order and length asserted directly, plus a real Escape-closes-it
  check; the individual actions are covered by their own key-path tests)
- **Status bar shows the short Context Flywheel loop, not the full
  stage-by-stage breakdown.** `updateStatusBar()` renders `i18n.js`'s
  `lifecycle.bar`, `Capture·s → Organize·o → Learn·w → Reuse·n`, plus
  the `?`/`q` hint. It used to spell out all four stages and every key
  belonging to each (`Capture·s → Organize·m/t/o → Learn·a/w →
  Reuse·n/h/r`), the only thing trying to teach the whole model on a
  permanent one-line status bar visible on every screen. The current
  form keeps the same four canonical stage names but pairs each with
  just its one flywheel key, matching the day-to-day loop the tutorial's
  own recap teaches, not the full key inventory. Digest (`d`) is real
  and still documented in its own line below; it just isn't one of these
  four canonical stages. The full breakdown moved into `help.text` (`?`
  modal) as a leading section, the loop first, the complete key-by-key
  reference below it. Factored out of `setLevel()` so `reloadAll()` can
  also refresh it, a language switch via `l` otherwise left it in
  whichever language was active at mount time. [untested]
- **`asyncReviewFlowRunning` guards `o`/`w`/Shift+S/Shift+M against a
  double-press while the LLM call is still in flight.** All four are
  async: show a spinner, `await` a real `complete()` call, then open a
  review modal (`o`/`w`/Shift+S) or apply directly (Shift+M has none).
  None disable their own key while waiting, so an impatient repeat press
  used to start a second concurrent run, a second spinner, a second LLM
  call, and eventually a second review modal stacking on top of the
  first. Closing just the top one left the other still parented
  underneath, so the tutorial's own `isModalOpen()` check never saw the
  screen's child count drop back to baseline, permanently stuck waiting
  for a close that could never fully arrive. One shared flag covers all
  four (mutually exclusive anyway), set on entry and released the
  instant each one's own immediate step finishes, never held through the
  later async best-effort auto-summarize phase merge/split both have.
  [tested] (`test/e2e/demo-e2e.test.js`'s "an impatient double Shift+S
  while the LLM call is in flight" case double-presses inside the mock
  delay window and asserts only one modal opens and closing it returns
  exactly to baseline; the same file's merge-then-immediate-split case
  is the regression test for the guard-scope revert mentioned above)

## TUI: Calendar tab (`src/tui/views/calendar.js`)

Month grid, day list, and detail, same drill-down language as Sessions. Grid left/right move the day cursor by 1 day and up/down by 1 week; both roll into the adjacent month at the edges (moveDay uses Date arithmetic and reloads that month's counts when the boundary is crossed). PgUp/PgDn jump a whole month, keeping the same day-of-month. **`r`/`h`/detail-Enter are about 40 lines independently duplicated from Sessions**, a deliberate, self-acknowledged choice by the original author (resume and handoff churned enough that sharing felt riskier at the time), the clearest extraction candidate in the codebase. Tab activate/deactivate preserves the calendar's own cursor position across switches (lazy created once, cheap to reactivate). [untested]

## TUI: Tutorial / `mycelium demo` (`src/tui/tutorial.js`, `tutorial-data.js`, `tutorial-mock-llm.js`, `personas.js`)

**Persona-selectable mock content (`src/tui/personas.js`).** Before seeding, both `mycelium demo` and a first-run user who opts into the tour pick one of three personas via a `menu()` picker (`pickPersona()` in `tui/index.js`): **Software Engineer** (an Amazon-retail-style developer building a new "Express Reorder" feature across a backend and a frontend session, plus two more unrelated storylines, 6 sessions total), **Cloud Support Engineer** (cross-service troubleshooting an on-prem to VPC connectivity issue across separate DX/VPC/ALB sessions that turn out to share one MTU root cause, merged 3-way, plus a second S3 case, 5 sessions total), and **Solutions Architect** (researching AI agent platform best practices and reference architectures for a customer, merged into one body of research that feeds a proposed architecture, plus two more customer-meeting storylines, 6 sessions total). Each persona bundles, per storyline, its own `{folder, keywords, knowledge, sessions}`, and for the one storyline that's the tutorial's merge/split target, `splitLabels`, so `tutorial-data.js` (`buildMockSessions(personaId)`) and `tutorial-mock-llm.js` (`createTutorialMockProvider(personaId)`) both derive from this single source instead of maintaining separate copies of the same folder names/keywords (a real bug class earlier in this feature's history: folder-name mismatches between the two files broke merge/split). Each persona now includes one `opencode` mock session alongside `claude`/`codex`/`kiro`, converted from a previously redundant `claude` session (never a merge target, so Shift+M/Shift+S demo behavior is untouched) rather than dropping any existing adapter to zero. `test/tutorial-data.test.js`'s source-validity check now derives its allowed set from the real `ADAPTERS` registry instead of a hardcoded `['claude', 'codex', 'kiro']` list, so a future adapter addition can't silently go unchecked the way this one would have. `seedMockSessions(personaId)`/`startTutorial(app, onDone, personaId)` thread the choice through; `i18n.js`'s step2/4/5/13 body strings take extra interpolation args (session count, merge-target folder) via `t()`'s existing `(fg, ...args)` support. `personaId` defaults to `'swe'` wherever omitted. [tested] (`test/tutorial-data.test.js`, `test/tutorial-mock-llm.test.js` cover all three personas' data/ classification/knowledge/split output and source validity; `test/e2e/demo-e2e.test.js` has a dedicated case driving the CSE persona's real 3-way merge to split through the fake-terminal harness)

`seedMockSessions()` also pre-stages a knowledge-refresh proposal (`insight.js`'s `writePendingKnowledgeText()`, using the merge storyline's own canned `knowledge[locale]` text, the same content `w`'s mock preview would show for that folder) for the merge-target folder, as if the daemon's independent `knowledgeReviewCycle` had already computed it overnight. This lets step 9 (`k`) hit the same "reuse whatever's queued" fast path a real user gets when the daemon beat them to it, and sidesteps a genuine problem: every persona's mock session dates are backdated (`daysAgo: 1` to `10`) for calendar-tab realism, so `k`'s own "compute fresh for *today*" fallback would find zero active folders during a scripted run. Cleanup is automatic, not special-cased: `endTutorial()`'s existing `pruneEmptyFolders()` call removes any folder directory with no real session left in it once demo sessions are swept, taking a leftover pending file with it too.

**Bilingual (en/ko) persona content, not just bilingual chrome.** Every persona's `title`/`summary`/`turns` (per session) and `knowledge`/`splitLabels`/`keywords` (per storyline) are `{en, ko}`, each turn is one `{role, en, ko}` object, not two parallel arrays, so the two languages can't silently drift apart in length or order. `folder` (a real directory name under `~/.mycelium-demo/tree/`) and `tags` stay single, shared, ASCII values in both languages, mirroring how real project folder names and tech-stack tags stay English/ kebab-case even on Korean-speaking teams. `keywords` is genuinely language-specific, not just translated, it's matched against whichever language the mock summary is actually rendered in. `buildMockSessions(personaId, locale)` / `createTutorialMockProvider(personaId, locale)` resolve `.en`/`.ko` at build time; `locale` defaults to `i18n.js`'s `getLocale()`. A new `pickLanguage()` step (`tui/index.js`), "Choose your language / 언어를 선택하세요," shown bilingually since the language isn't known yet, runs right before `pickPersona()`, for both `mycelium demo` and first-run onboarding, so the persona picker's own labels and everything the tutorial seeds/narrates after it are already in the picked language. `sessionsView()`'s status bar (`app.setStatus(...)`) is otherwise only re-set on a panel-level change (`setLevel()`), which used to leave it in whatever language was active when the view first mounted; factored into `updateStatusBar()`, now also called from `reloadAll()`. For an already-onboarded real session, **`l`** (global, `app.js`) confirms and switches via the same `setLocale()` plus restart `mycelium lang <en|ko>` already required, a live in-place hot-swap isn't safe since `sessionsView()` doesn't clean up its own `screen.key()` bindings on unmount. [tested] (`test/tutorial-data.test.js`/`test/tutorial-mock-llm.test.js` assert Korean content/classification/knowledge/split-labels match their English counterparts 1:1 in shape; `test/e2e/demo-e2e.test.js`'s "ko locale" case drives a real organize→learn flow and asserts the saved KNOWLEDGE.md file itself contains Korean text, not just Korean menus around English content)

**`mockSplit()`'s split-range computation is dynamic, not hardcoded.** Every persona's individual mock sessions happen to have 4 turns each, but `mergeSessions()` prepends a provenance separator turn (role `'system'`) before each merged block, and the CSE persona's merge target is a 3-way merge, so the real turn count the split prompt numbers varies by persona and is no longer always 4. `mockSplit()` reads the actual highest turn number out of the prompt via regex, splits it roughly in half, and labels the two halves with the active persona's `splitLabels`, a fixed response used to silently drop every turn past 4 for any merge bigger than 2x2.

**Highest state-machine complexity in the app.** A narrator overlay runs its own `app.screen.on('keypress', ...)` listener alongside (never wrapping) sessions.js's real handlers, inferring "did a real action's modal open/close" by polling `app.screen.children.length` against a captured baseline, a generic heuristic that works because every picker/viewer in the codebase parents itself to `app.screen`. 19-step script: an opening step stating what Mycelium actually is (Capture → Organize → Learn → Reuse), merged with the panel-navigation lesson (← → between Folders/Sessions/Detail), an action-palette intro (`.`), then the full lifecycle, Scan (`s`) → Organize (`o`) → Learn (`w`) → Reuse (`n`, an agent picker → directory picker → copy-command flow that writes a real `AGENTS.md` — see below, not the read-only `c` preview this replaced) → Knowledge review (`k`) → session lineage (Shift+M merge, Shift+S split) → freeform explore, closing on a recap of the day-to-day loop (`s`/`o`/`k`/`n`, framed as "the Context Flywheel," noting that most of it already runs on its own in the background so pressing those keys is mostly reviewing and confirming, not starting from scratch). `render()` computes the visible `Step N/Total` label from `STEPS.length` and the current index rather than baking a number into each title string, so inserting or removing a step is a pure array edit. The opening step's `waitFor` is `'enter'`, on that exact screen Enter is also `sessions.js`'s own real `foldersBox.key('enter', drillIntoSessions)`, so pressing it both advances the narrator and performs the literal "step into Sessions" action the lesson describes. Mixing `waitFor`+`thenWait` (poll for a real modal), plain `waitFor` (a literal key), a `shift: true` flag (blessed's raw keypress reports Shift+M as `key.name: 'm'` plus `key.shift: true`, not the `'S-m'` combo-string form only `element.key()` bindings understand), and `pollOnEntry` (used by the merge title-prompt step and the Reuse step's picker-chain-close step, both of which poll for the state change directly rather than waiting on one specific key).

**Reuse step demonstrates the real `n` mechanism, not a preview of it.** `doNewAgent()` (`sessions.js`) passes `copyOnly: !!app.tutorialSignal` into `launchAgent()` (`launch.js`) — truthy for the tutorial's whole duration, so its `n` step can never foreground a real, possibly-billed agent subprocess on a stray click; it always takes the copy-command path. `launchAgent()`'s agent-availability check and `agents.js`'s `newCommandLine()` both also bypass the real `which()` install check while `MYCELIUM_DEMO_MODE === '1'` (the same flag `scanner.js` already branches on to skip real adapter scanning during a tutorial run) — CI and most contributors' machines have no agent CLI installed at all, which would otherwise leave the picker empty and strand the step's `thenWait: 'open'` poll forever. Every mock session is stamped with a real, disposable `projectDir` (`tutorial.js`'s `tutorialProjectDir()`, `${HOME}-tutorial-repo`, mirroring the pitch video's `${MYCELIUM_HOME}-repos/<folder>` pattern), created in `injectDemoSessions()` and removed in `endTutorial()`, so the step's directory picker offers a clean real suggestion and its "go check the real AGENTS.md" instruction points somewhere genuinely real (but fake), never the user's actual project. [tested] (`test/e2e/demo-e2e.test.js`'s dedicated `n` case asserts `copyOnly` skipped the choice menu and a real `AGENTS.md` landed on disk with the folder's actual knowledge; `test/agents.test.js` covers the `MYCELIUM_DEMO_MODE` bypass)

**Skip-ahead matching, restricted to distinctive keys.** Because this listener only narrates alongside sessions.js's real handlers, a human who presses a later step's key before the current step's own, for example `o` while still on step 1's pure panel-navigation lesson, still triggers the real action regardless. An exact match on the current step still always wins; failing that, it scans forward for the first later step this keypress satisfies, but **only** for `o`/`w`/`n`/Shift+M/ Shift+S (`AMBIGUOUS_KEYS` in `tutorial.js` excludes `enter`/`left`/ `right`, since those are pressed constantly for reasons that have nothing to do with the tutorial script and a false match on one of them could silently jump the narrator several steps ahead). [tested] (`test/e2e/demo-e2e.test.js`'s "pressing a later step's key early" case drives the legitimate `o` skip-ahead end to end and asserts the narrator still reaches `completed: true`; "a stray Enter on step 1 does not falsely cascade the narrator forward" is the regression test for the false-match case)

**`.`-menu selections advance steps too, via a signal, not by guessing from Enter.** Selecting a palette item confirms via Enter, the same key that confirms or closes lots of other dialogs, so raw keypress-matching structurally can't tell "Enter selected Organize from the menu" apart from "Enter did something unrelated." `sessions.js`'s `doScan`/`doOrganize`/`doKnowledge`/`doMerge`/`doSplit`, the same named functions already shared between direct-key and menu dispatch, each call `app.tutorialSignal?.(name)` past their own guard checks, so e.g. Shift+M with fewer than 2 selected never fires a false "merge happened" signal. `tutorial.js` consumes it with the same lifecycle as `app.quitGuard`, and shares the exact same advance-and-poll tail as a matched keypress, a menu-triggered organize/knowledge/merge/split still waits for the real review modal to open before advancing; only Scan (no review modal at all) advances on the signal itself, fired at genuine completion (`scan.done`), not function-entry. [tested] (`test/e2e/demo-e2e.test.js`'s "selecting Organize from the `.` action menu advances the narrator too" and "the new Scan step advances via the `.` menu too" cases drive both real menu-selection paths end to end)

**Scan step: the Sessions view starts genuinely empty, and pressing `s` is what fills it in.** `index.js`'s real tutorial-launch paths (`mycelium demo` and first-run onboarding) mount the Sessions view empty and call `prepareTutorialProvider(personaId)` only, LLM mock plus a pre-staged knowledge proposal, no session rows yet. The mock sessions are written by `injectDemoSessions(personaId)` (`tutorial.js`), fired from `app.tutorialSignal('scan')`, the same signal `sessions.js`'s `doScan()` sends on genuine completion, so "press `s` to capture them" is literally true, not staged: nothing is on screen until that exact keypress, then the persona's full mock set appears via the caller-supplied `reloadSessions` callback. `seedMockSessions()` still exists as a convenience wrapper (both steps, eagerly) for callers that want the whole demo store ready without driving the tutorial through its own Scan step; most of the e2e suite still uses it, passing `sessionsPreSeeded: true` to `startTutorial()` so the Scan step's own injection is skipped for them (`injectDemoSessions()` isn't idempotent, `buildMockSessions()` stamps a fresh `randomUUID()` per call, so injecting on top of an eager pre-seed would double the set). Separately, `scan()` itself reads each agent's real global store (`~/.claude`/`~/.codex`/`~/.kiro`, and OpenCode's own `opencode.db`), completely unaffected by `MYCELIUM_HOME`, a problem for both tutorial-launch paths, not just `mycelium demo`'s isolated walkthrough: first-run onboarding runs against the real `~/.mycelium`, so a real, unguarded `scan()` there would import the user's actual real content into the very same batch `injectDemoSessions()` is about to add. `startTutorial()` (`tutorial.js`) sets `MYCELIUM_DEMO_MODE='1'` itself for the tutorial's whole lifetime, saving and restoring whatever value was there before (so `mycelium demo`'s own child-process `MYCELIUM_DEMO_MODE=1` isn't disturbed either); `scan()` skips the real `ADAPTERS` loop entirely while it's set, so the real scan alongside the mock injection always reports `scanned 0, imported 0` for as long as either tutorial flow is active. The user's actual first real scan still happens, just once onboarding concludes and `startUpkeepAndRecheck()`'s background `scanCycle()` takes over (`index.js`), not interleaved with the demo walkthrough itself. [tested] (`test/scanner.test.js`'s `MYCELIUM_DEMO_MODE` case for the scanner-side guard; `test/e2e/demo-e2e.test.js`'s "the Sessions view is genuinely empty until the Scan step" case for the empty-then-inject behavior end to end, "the new Scan step advances via the `.` menu too" for the already-pre-seeded/no-duplication path, and the two `startTutorial()` set/restore `MYCELIUM_DEMO_MODE` cases, both the normal unset-before case and `mycelium demo`'s own pre-set-to-'1' case)

**Exit model, deliberately simple.** `q` exits the tutorial from any step, immediately, no confirm, checked once at the very top of `onKeypress`, before even the `waiting` gate, so it works reliably mid-wait or with any real modal open. Only counts as a full "completed" run (which `cli.js`'s `demo` command reads as "hand off to the real TUI") if pressed on the actual last step; `q` on any earlier step is just "done early, no handoff." Escape is not handled by the tutorial at all, on any step, it just does whatever the real widget/view underneath does with it. This replaced an earlier design where Escape doubled as "abort the tutorial," which kept colliding with real modals' own close key as a side effect, so the whole mechanism was cut in favor of one rule that holds everywhere: q exits, Escape closes. `app.quitGuard` still suppresses the app's own global `q` binding for the tutorial's duration and is released via `setImmediate`, not synchronously, to dodge a same-physical-keypress race with that global binding. `app.js`'s Ctrl+C binding is deliberately not gated by `quitGuard` at all: Ctrl+C is a hard, unconditional exit throughout, by design. `o`/`w`/Shift+S all call real LLM-bound functions; `seedMockSessions(personaId)` swaps `llm.js`'s `complete()` over to `tutorial-mock-llm.js`'s `createTutorialMockProvider(personaId)` for as long as the mock sessions exist, so these resolve quickly and deterministically instead of via a real subprocess call. The returned provider still resolves after a deliberate ~5s delay (`MOCK_DELAY_MS`, overridable via `MYCELIUM_DEMO_MOCK_DELAY_MS`), not instantly, since a 0ms response is its own regression: `app.js`'s animated spinner never gets a frame to actually animate and the wait reads as "did that run at all?" The mock's own dispatch/parsing now branches on the same `locale` the real prompts follow (`config.js`'s `contentLocale()`) so a demo run stays internally consistent.

**Demo to real handoff.** Finishing the tutorial's final step (`completed: true`, `q` pressed on the actual last step) no longer just resets into the by-then-empty `~/.mycelium-demo` store. Instead `app.quit(DEMO_HANDOFF_EXIT_CODE)` exits the isolated child process with a sentinel code; `cli.js`'s `demo` command watches for exactly that code on the child's `exit` event and, only then, dynamically imports and runs the real TUI in the (unmodified-env) parent process, landing the presenter in their actual `~/.mycelium` data instead of a bare shell prompt. `q` pressed on any earlier step just exits plainly, no handoff. On a full handoff, `cli.js` also reads the isolated demo store's own `config.json` for whichever locale was picked in `pickLanguage()`, and calls the real `setLocale()` with it before starting the real TUI, so continuing straight into real data feels linguistically seamless. Deliberately scoped to the full-handoff path only: previewing the demo in a different language shouldn't silently change real settings unless the presenter actually continues into real data right after. `render()`'s persistent footer (`tutorial.exitHint`, "q: exit tutorial") is step-aware: every step but the last keeps that wording, the last step shows a distinct `tutorial.finishHint` ("q: finish & switch to your real data") instead. Before starting the real TUI, `cli.js` also stamps `onboarded: true` onto the real config, a real bug had the handoff carry over locale but not this flag, so `runTui()`'s own onboarding check saw a "first launch" immediately after the tutorial and re-showed the language/tour picker on top of the just-handed-off real session list. [tested]

**Handoff transition speed and stray-keystroke safety.** From child-exit to a rendered real screen, `cli.js`'s handoff branch used to do three cold `await import()`s in the visible gap. Fixed with three changes: (1) `import('./tui/index.js')` is kicked off right after spawning the child, not awaited until the handoff branch, so the cold import resolves in the background during the tutorial's own tens of seconds of interaction; (2) a locale-aware transition message prints immediately at the top of the handoff branch, before any other async work; (3) `process.stdin` is actively resumed then drained for a deliberate 120ms during the handoff, discarding whatever arrives, since an impatient repeat `q` right after the first was confirmed to leak into the newly-mounted real session and could have exited it. **Known remaining limitation**: the shell now paints about 200ms after the child exits, but a further freeze, roughly 2s for a 65-session real backlog and scaling with backlog size, still follows, because `scan()` blocks the event loop synchronously. That needs `scan()`'s file I/O converted to async, a separate, larger, not-yet-scoped change. [tested] (`buildMockSessions()` and `tutorial-mock-llm.js`'s prompt-dispatch/ classification/folder-lookup logic are unit-tested as pure functions; `test/e2e/demo-e2e.test.js` drives the real interactive state machine end to end: organize→learn→reuse→merge→split, the exit-key model, and the demo→real handoff itself)

**TUI testability feasibility note** (investigation only, no code changed). `isModalOpen()` (`app.screen.children.length > baseline`) is the one thing blocking the STEPS reducer from being unit-tested without blessed. Promoting it to an explicit `app.modalDepth` counter would make the reducer testable in isolation, but it isn't a localized change: every picker/prompt/viewer that self-parents to `app.screen`, all of `src/tui/widgets/*` plus every ad hoc box/list in `sessions.js`/ `calendar.js`/`launch.js`, would need to increment or decrement it consistently on every exit path. That's cross-cutting surgery with its own risk profile, explicitly out of scope here; a follow-up plan should treat it as its own reviewed change.

**`isModalOpen()`'s blind spot to permanent widgets** (real bug, fixed). The `app.screen.children.length > baseline` heuristic only detects widgets that get freshly parented to the screen, it's blind to a visibility toggle on something mounted once and reused, exactly what `app.js`'s `toast` widget is. `sessions.js`'s merge (`Shift+M`) and split (`Shift+S`) handlers each start a second, synchronous auto-summarize spinner immediately after their own review modal is destroyed; the narrator's `thenWait: 'close'` poll saw the review modal's child-count drop and advanced right away, while the auto-summarize spinner was still visibly on screen underneath the next step's caption. Fixed with a `busyWidgets` reference counter on `app`, incremented and decremented by both `startSpinner()` and `startProgressBar()` around their `stop()`, exposed as `app.isBusy()`; `isModalOpen()` now checks `app.screen.children.length > baseline || app.isBusy()`. [tested] (re-verified via a disposable VHS tape driving the real `mycelium demo` end to end, frame-extracted at the split step's confirm-to-auto-summarize transition before and after the fix; `test/e2e/demo-e2e.test.js`'s existing merge/split coverage continues to pass unchanged)

`test/e2e/demo-e2e.test.js` doesn't unit-test the STEPS reducer in isolation, it sidesteps the question by testing the real system end to end instead. `test/tui-helpers.js`'s `createTestApp()` gives `createApp()` fake `input`/`output` streams, and writing real bytes to the fake input stream drives blessed's actual keypress parsing, which the real `element.key()` bindings depend on (a bare `screen.emit('keypress', ...)` does not reach them). The test then uses the exact same `screen.children.length > baseline` heuristic `isModalOpen()` uses internally, from the outside, to know when to send the next key, real coverage of the actual narrator, widgets, and data layer together, at the cost of not being a fast, isolated unit test of the reducer alone.

**Narrator box could be hidden behind a real modal opened on top of it** (real bug, fixed). The narrator's own box is created once, at tutorial start, bottom-anchored and full-width. Every real widget a later step opens gets parented to `app.screen` afterward, so blessed draws it on top wherever the two overlap; `textView()` alone is tall enough to reach into the narrator's own bottom strip. Reported directly: opening the context viewer on step 7→8 visually covered the narrator's guidance, making it look stuck. Fixed with `box.setFront()` called on every `render()`, so the narrator always redraws on top of whatever opened since, no matter which step or which real widget. [tested] (`test/e2e/demo-e2e.test.js`, confirmed to fail on `main` before the fix by asserting the narrator box's position in `app.screen.children` right after the context viewer opens)

---

## Cross-cutting duplication (architecture revamp candidates)

1. ~~**Folder-subtree matching**~~ **FIXED.** Was 5+ independent
   implementations of `folder===X || folder?.startsWith(X+'/')` across
   `organize.js`/`index-db.js`/`insight.js`. Extracted to
   `isInSubtree(sessionFolder, scopeFolder)` in `src/organize/folders.js`,
   re-exported through the `organize.js` barrel; `index-db.js`/
   `insight.js` import it the same way they already import `isArchive`.
2. ~~**Backlink-array cleanup on delete**~~ **CORRECTED, not extracted.**
   Re-inspecting `deleteSession`/`unmerge`/`unsplit` directly found only
   `deleteSession` does a real full-store backlink **sweep** (checks
   every other session's `continuedTo`/`mergedFrom`/`supersededBy`/
   `splitInto`). `unmerge`/`unsplit` each clear a **single known field on
   specific already-known ids**, a materially different, thinner
   operation with no real logic to share with the sweep. No helper
   extracted; this entry stays only as a correction to the original
   survey.
3. ~~**"First real user turn" extraction**~~ **FIXED**, deliberate
   behavior change. `handoff.js`/`insight.js` used to bypass
   `schema.js:firstUserText()` with their own inline
   `turns.find(t => t.role === 'user')`. Split `firstUserText()` into
   `firstUserTurn()` (the untruncated turn, new export) plus
   `firstUserText()` (200-char preview built on top of it), since
   calling `firstUserText()` directly would have also imposed its
   200-char list-preview cap onto handoff's ~800-char excerpt and
   insight's ~80-char digest line. Both callers now use `firstUserTurn()`
   and apply their own existing truncation. Covered by
   `test/schema.test.js`, `test/handoff.test.js`, and an addition to
   `test/insight.test.js`.
4. ~~**Resume/handoff/copy trio**~~ **FIXED.** About 40 lines that were
   duplicated wholesale between `sessions.js` and `calendar.js`
   extracted into `createResumeHandoff(app, {getCurrentRow, afterResume, afterHandoff})`
   in `src/tui/resume-handoff.js`. `getCurrentRow`/`afterResume`/
   `afterHandoff` stay as per-view parameters rather than being unified
   further: sessions.js's detail-triggered resume explicitly returns to
   the 'sessions' level while its handoff path doesn't, a real
   pre-existing difference this extraction preserves; calendar.js uses
   one shared `afterAction()` for both. Manually smoke-tested via tmux
   against the demo store, `r`/`h`/detail-Enter all verified in both the
   Sessions panel and the Calendar tab, no crashes. No automated test
   coverage (blessed/TUI code, same as the rest of the TUI).
5. **Live-preview-on-navigate.** The same arrow-key-preview idiom
   hand-copied 3 times: folders panel, sessions list, calendar day list.
6. **LLM batching.** Three different concurrency models across
   `learn.js`, `organize.js`'s two batch functions.
7. ~~**`organize.js` is a 595-line god-module**~~ **FIXED.** Split into
   `src/organize/folders.js` (folder CRUD), `src/organize/classify.js`
   (the LLM classification workflow), `src/organize/lineage.js` (manual
   mutation plus merge/split/continuation lineage), with
   `src/organize.js` kept as a barrel re-export
   (`export * from './organize/*.js'`) so every existing importer's
   `'../organize.js'` path is unchanged. Modeled on k9s's
   per-resource-type DAO split (`internal/dao`), one small file per
   responsibility behind a stable import path, not a deep layered
   folder tree.
8. ~~**`daemon.js` mixes** cycle/scheduling policy with OS process
   lifecycle~~ **FIXED.** Split into `src/daemon/cycles.js`
   (scan/organize/digest cadence) and `src/daemon/process.js`
   (spawn/detach/pidfile), same barrel pattern as `organize.js`. Also
   dropped a dead `if (import.meta.url === ...) runDaemon()` bootstrap
   line, confirmed via grep that `daemon.js` is never executed directly.
9. **`llm.js` mixes** subprocess spawning with pure text utilities
   (`extractText`, `parseJsonReply`) that have zero dependency on it.
10. ~~**`config.locale` is honored only by the TUI**, every LLM prompt
    in the core layer (`learn.js`, `insight.js`, `organize.js`,
    `split.js`) is hardcoded Korean regardless of locale setting~~
    **FIXED.** `config.js`'s new `contentLocale()`
    (`loadConfig().locale === 'ko' ? 'ko' : 'en'`, same fallback
    `i18n.js`'s own `getLocale()` uses) is now read by all four; each
    hardcoded-Korean prompt/error string gained an English branch
    alongside the original (unchanged) Korean one. A locale switch now
    affects generated *content* (auto-tag titles/summaries,
    classification reasons, digest narrative, KNOWLEDGE.md text, split
    labels) the same way it already affected UI chrome, not just the
    screen around it.
