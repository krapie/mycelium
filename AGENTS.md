# AGENTS.md

Orientation for an AI coding agent (Claude Code, Codex, Cursor, or similar) working in this repository. If you're a human, [`README.md`](./README.md) and [`docs/`](./docs) are the better starting point — this file is dense and reference-oriented on purpose.

This follows the [AGENTS.md](https://agents.md) standard — read natively by Codex and other AGENTS.md-aware tools. **Claude Code does not read AGENTS.md on its own** (confirmed against Anthropic's own docs — it only ever auto-loads `CLAUDE.md`), so `CLAUDE.md` in this repo's root just imports this file via `@AGENTS.md`. That's also exactly the gap `src/reuse.js`'s `injectAgentsMd()` needs to account for when writing to a *target* project — see that file's own doc comment.

## What this tool is

Mycelium is a local-first Context Lifecycle TUI for AI coding-agent sessions. It manages context produced by AI collaboration through four stages — **Capture → Organize → Learn → Reuse** — implemented as a terminal UI (`neo-blessed`) plus a CLI, both reading/writing a plain-file store under `~/.mycelium/`.

## Why it exists

AI coding sessions (Claude Code, Codex, Kiro, ...) accumulate fast and lose context across three axes:
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
- **Human-facing text**: LLM prompts (in `learn.js`, `insight.js`, `organize.js`'s classification, `split.js`) and their expected JSON output are in Korean, always — this is a deliberate content-language choice, not tied to UI locale and not something to translate. TUI strings go through `src/tui/i18n.js`'s `t()` (English default; switch to Korean via `mycelium lang ko`, the in-TUI `l` key, or the language picker shown on first launch / before every `mycelium demo` persona pick — see Key bindings below). Code identifiers, comments, README/docs, and commit messages are English. The tutorial/`mycelium demo` is the one exception to the Korean-*prompt* rule: it never calls a real LLM (see Tests below), so its canned output doesn't need to match the real prompts' language — instead it matches whichever UI locale is active (`tui/personas.js`'s mock session content is fully bilingual, `{en, ko}` per field, not just the surrounding chrome).
- **Commit messages**: no enforced prefix convention (no `feat:`/`fix:`). Short subject line describing *what* changed, blank line, body explaining *why*. Look at `git log` for tone — some history is in Korean (predates this convention), but write new commit messages in English going forward.
- **Data-layer boundaries**: `raw/<id>.json` is the source of truth; `db/index.db` (sqlite/FTS5) is a derived, always-rebuildable index (`reindex()`/`mycelium cleanup index`). Never treat the index as authoritative — if a bug looks like a data-consistency issue, check whether `raw/` and the index have simply drifted.
- **`organizedBy: 'human'` is sticky.** Any code path that assigns a folder automatically must check this flag and never overwrite a human-placed session. This is the one invariant most of `organize.js`'s classification workflow exists to protect.

## Docs conventions

- `README.md` stays trimmed to Intro/Requirements/Install/Getting Started/Learn More/Cleanup/Contributing — anything more detailed belongs in `docs/`, linked from "Learn More."
- `docs/features.md` is a **living catalog**, not a one-time snapshot: every module's capabilities as "As a user, I can ___" stories with file:line references, invariants, and a coverage marker (`[tested]` / `[partial]` / `[untested]`). **When you add or change a capability, update its entry and coverage marker in the same change** — this file and the test suite are meant to track each other.
- Markdown prose is **not hard-wrapped** — one paragraph per source line, let the viewer soft-wrap. (Established after CLA.md/CONTRIBUTING.md were found hard-wrapped at ~80 cols while the rest of `docs/*.md` wasn't; un-wrapped to match the dominant convention. Code blocks and lists are unaffected either way.)

## Tests

`node:test` (Node's built-in runner, zero new dependency) — `npm test` runs everything under `test/` (unit + e2e). `npm run test:unit` runs only `test/*.test.js` (fast, seconds); `npm run test:e2e` runs only `test/e2e/*.test.js` (slower — real blessed screens against fake terminal streams, several seconds per test). CI (`.github/workflows/ci.yml`) runs these as two separate jobs so a unit-test failure surfaces immediately without waiting on the slower e2e job. No mocking framework; hand-written fakes/seams only.

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
- Adapters intentionally read from the real `~/.claude`/`~/.codex`/`~/.kiro` (see `src/adapters/index.js`'s `ADAPTERS`), not `MYCELIUM_HOME` — `scan()` tests that need deterministic counts temporarily splice `ADAPTERS`' contents down to fake adapters and restore the real ones in a `finally` (see `test/scanner.test.js`'s `withOnlyAdapters()`).
- **TUI/blessed code** (`src/tui/**`, beyond pure helpers like `render.js`) has one automated e2e layer: `test/e2e/demo-e2e.test.js` (run via `npm run test:e2e`, its own CI job — see Tests above), which drives the REAL `createApp()`/`sessionsView()`/`startTutorial()` handlers against fake `input`/`output` streams (`test/tui-helpers.js`'s `createTestApp()`/`sendKey()`) instead of a real TTY — no tmux, no pty. Real bytes on the input stream (not synthetic keypress objects) are required: `element.key()` bindings (every `screenKey()`/`listBox.key()` call in `sessions.js`) depend on a `program`-level `'key <name>'` event only emitted from real keypress parsing, which a bare `screen.emit('keypress', ...)` never reaches — see that file's module comment. It covers the organize→learn→reuse→merge→split flow and the tutorial's exit-key behavior; it does **not** assert rendered pixel/ANSI output (fragile, low value) — only real resulting state (session records, file contents, the `onDone(completed)` callback). Anything not covered by that suite (calendar, other pickers/viewers, general TUI polish) still has no automated coverage — verify manually (`node src/cli.js demo` against the isolated `~/.mycelium-demo` store is the safe way to interact with realistic data without touching anything real).

## Key bindings (TUI)

Full reference: [`docs/tui.md`](./docs/tui.md). Quick map, since a change to any of these keys touches `src/tui/views/sessions.js`/`calendar.js`:

| Stage | Keys |
|---|---|
| Capture | `s` scan |
| Organize | `m` move · `t` tag · `o` smart organize |
| Learn | `a` auto-tag/summarize · `w` extract folder knowledge |
| Reuse | `n` new agent · `Shift+N` new agent, copy command instead (parallel sessions in another tab) · `h` handoff · `r` resume · `i` inject AGENTS.md |
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

<!-- mycelium:begin -->
<!-- Mycelium이 관리하는 영역입니다. 직접 수정하지 마세요. -->

# Projects/Mycelium — Project Knowledge

# Mycelium 프로젝트 지식

## 핵심 개념

**Mycelium**은 AI 에이전트 온보딩/오프보딩 플랫폼이다. AGENTS.md를 중심으로 한 "지식 주입" 모델을 사용하며, 각 세션 시작 시 AGENTS.md의 메타데이터를 파싱하여 에이전트 인스턴스에 주입한다. 사용자는 TUI의 `i` 키로 AGENTS.md를 수동 새로고침할 수 있다.

Mycelium의 자동화는 **Capture→Learn→Reuse** 사이클을 중심으로 작동한다:
- **Capture/Learn**: 항상 자동 (세션 기록 및 AGENTS.md 생성)
- **Reuse**: Mycelium 런처에서만 자동 (직접 실행한 claude-code에서는 AGENTS.md 수동 새로고침 필요)

## Relay: 멀티 에이전트 오케스트레이션 레이어

**Relay**는 "Celery for coding agents"로 포지셔닝되는 vendor-agnostic 작업 런타임이다. 다양한 에이전트 CLI(Claude Code, Codex, Gemini 등)를 **adapter 패턴**으로 pluggable하게 통합하며, 에이전트 위에 오케스트레이션 레이어를 제공한다.

핵심 구성요소:
- **작업 큐**: 에이전트 작업을 큐에 enqueue하고 분배
- **스케줄러**: 작업 실행 일정 관리
- **비용/할당량 라우팅**: 다양한 에이전트 간 비용과 할당량 기반 동적 라우팅

## 로드맵 우선순위 (relay 이후)

1. **멀티 에이전트 어댑터** — 추가 벤더 에이전트 통합 (OpenAI Swarm, Claude SDK agents 등)
2. **Enqueue MCP 툴** — Relay에서 MCP 도구 직접 호출 가능하게
3. **모델 핸드오프 폴백** — 한 모델 실패 시 다른 모델로 자동 폴백
4. **FinOps** — 에이전트별 비용 추적 및 최적화
5. **Vibe-Kanban 임포터** — 외부 칸반 도구 통합

## UI 컨벤션 및 기능

- `v` 키: Sessions ↔ Calendar 탭 전환
- `i` 키: AGENTS.md 수동 새로고침
- **세션 분할/병합**: Git-like 명령어 지원 (세션을 분기/병합 가능)
- **캘린더**: 모달이 아닌 탭으로 구현

## 세션 지속성 및 핸드오프

병합/분할 세션의 lineage 추적:
- `mergedFrom` — 병합 원본 세션
- `splitFrom` — 분할 원본 세션
- `supersededBy` — 대체된 세션
- `continuedTo` — 계속된 세션

세션 삭제 시 다른 세션의 이들 백링크를 자동 정리한다. 병합/분할 세션에서 핸드오프한 새 세션은 원본에 자동 흡수된다.

## 보안: Hugging Face 모델 악성 공격

HF에 실제로 악성 모델이 유포된 사례가 있다:
- **JFrog (2024년 2월)**: pickle 직렬화 공격으로 100+ 악성 모델 발견
- **ReversingLabs (2025년 2월)**: 추가 피해 사례 보고
- **HF-JFrog 파트너십 (2025년 3월)**: 자동 검사 기능 도입

주요 공격 벡터는 **pickle 역직렬화**와 **trust_remote_code** 파라미터이다. `.safetensors` 형식은 안전하다.

**LoadLens** (정적 분석 도구)는 JFrog 스캐너의 경쟁 도구가 아니라 **보완재**로 포지셔닝한다. JFrog는 동적 실행 감지에 초점이 있고, LoadLens는 설명 가능한 정적 분석을 제공한다.
<!-- mycelium:end -->
