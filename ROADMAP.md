# Roadmap

This is the road to a stable **1.0** release, and the larger bets that sit beyond it. It's organized by what needs to be true for 1.0, not by individual issues — issues are referenced inline and will close faster than this document changes.

Design principles ([`docs/architecture.md`](./docs/architecture.md) — local-only, model-agnostic, human-first, minimal dependencies) are the filter every item is checked against. The [Non-goals](#non-goals) section states what those principles rule out. No dates: Mycelium has not committed to release timing, and 0.x keeps shipping incrementally on the way to 1.0.

## Where 0.x stands

v0.3.2. The four-stage loop (Capture → Organize → Learn → Reuse) runs end to end against real sessions from Claude Code, Codex, Kiro, and OpenCode, and the TUI and CLI are already thin callers over a shared core. Several parts are still provisional: LLM output quality is being tuned against real model responses ([#70](https://github.com/krapie/mycelium/issues/70)), some adapter parse paths lack tests, and the localization scope is unsettled. Full capability inventory with test-coverage status: [`docs/features.md`](./docs/features.md).

## The road to 1.0.0

1.0 is the first release whose **data format, CLI surface, and core loop are stable enough to build a daily habit on** — an upgrade won't strand your store, a script won't break on a renamed flag, and the loop runs without babysitting. The work between here and there, grouped by what has to hold:

- **Drift-tolerant capture.** Every supported adapter parses real on-disk sessions reliably, and when a CLI changes its format, capture skips the one unreadable session instead of breaking the whole scan. The adapter parse paths that are currently untested — Kiro's live SQLite formats, OpenCode's default-DB resolution — get real coverage. _Done when_ every adapter has a fixture-backed parse test and a corrupt-input test.
- **Durable local store.** `raw/<id>.json` and the `~/.mycelium/` layout are treated as a stable on-disk format; the SQLite index stays a pure derivative any version can rebuild; a release that must change the schema ships a migration rather than a silent break. _Done when_ there is a documented store-format version with a migration path, and `reindex` is proven to reconstruct the index from `raw/` alone.
- **Provider-agnostic LLM layer.** Organize / learn / insight / split run on whichever agent CLI the user actually has ([#86](https://github.com/krapie/mycelium/issues/86)) and fail legibly — naming the fix — when none is usable; no feature hard-depends on one vendor. Kiro stays a first-class *capture* adapter but is best-effort as an LLM backend until it exposes structured output. _Done when_ the loop is exercised end to end against at least two providers and a machine with no agent CLI gets a clear message, not a stack trace.
- **Coherent interface.** TUI interaction follows one rule across every panel and widget — keyboard and mouse reach the same actions ([#68](https://github.com/krapie/mycelium/issues/68)) — and the CLI's subcommands and flags are stable, with deprecation warnings rather than removals. _Done when_ [`docs/tui.md`](./docs/tui.md)'s interaction model matches the code and the CLI surface is covered by dispatch-level tests.
- **Bounded localization.** The `ko`/`en` split is coherent and its scope is written down: no user-facing string silently ignores `mycelium lang`, and the keybinding-localization question ([#44](https://github.com/krapie/mycelium/issues/44)) is decided one way or the other. _Done when_ every human-facing string is either localized or documented as intentionally not.
- **Trustworthy onboarding.** `npm install -g` and the Homebrew tap both land a working binary, and `mycelium demo` plus the first-run tutorial complete without error on a clean machine ([#42](https://github.com/krapie/mycelium/issues/42)). _Done when_ demo and tutorial are covered by the e2e suite and pass in CI's bare environment.

## Beyond 1.0

Real directions, deliberately not gating 1.0 — each is a larger bet that builds on a stable core rather than blocking it:

- **GUI platform alongside the TUI** ([#38](https://github.com/krapie/mycelium/issues/38); also `AGENTS.md` decisions). A mouse-first surface over the same local store — drag-and-drop organization, multi-pane session/knowledge previews, native tabs for new agent sessions. The TUI stays the reference interface; still local-only, still no account.
- **Port from the Node PoC to Go** ([#52](https://github.com/krapie/mycelium/issues/52)). One static binary, no Node runtime, on a maintained TUI stack (`bubbletea`/`tview` — the k9s lineage this project already cites as its architectural reference). Same loop, data model, and `~/.mycelium/` layout; the Node version stays the behavior reference during any port.
- **Broader agent coverage.** Adapters past the current four — open-weight CLIs such as Qwen and Gemini — each one adapter file implementing `base.js`'s contract plus a registry entry, with scanning / resume / launch / picker all deriving automatically. Source: `AGENTS.md` decisions ("오픈웨이트 에이전트 어댑터"). OpenCode capture already shipped ([#78](https://github.com/krapie/mycelium/issues/78)).
- **Claude Code plugin.** A `SessionStart` hook that detects a Mycelium install and surfaces the existing `search()` / `resumeCommandLine()` paths into a running Claude Code session. Global `npm install -g` stays opt-in and user-confirmed. Source: `AGENTS.md` decisions ("Claude Code 플러그인").

## Non-goals

Derived from [`docs/architecture.md`](./docs/architecture.md)'s principles. Naming these is a design decision, not a missing feature.

- **No hosted service, Mycelium-owned server, or account system.** The store is local (`~/.mycelium/`, or `MYCELIUM_HOME`). Moving it between machines is a manual copy of `raw/` + `tree/` followed by `mycelium reindex` — not a sync service.
- **No telemetry, analytics, or phone-home.** The only outbound traffic is the LLM calls (organize/autotag/knowledge/split), which send selected session content to whichever CLI/provider the user already configured — the same as using that CLI directly.
- **No separate API key or credential.** `complete()` rides the user's existing `claude` / `codex` / `kiro` / `opencode` subscription. Anything that would require a dedicated paid key gets flagged as a principle deviation and decided explicitly, not adopted silently ([#86](https://github.com/krapie/mycelium/issues/86)).
- **No bundled or embedded model, no vendor lock-in.** Storage stays a neutral schema, never one agent's session format; adding an agent stays one adapter file.
- **No heavy dependency stack.** The TUI holds at a single runtime dependency (`neo-blessed`). A Go port would change the language and TUI library, not the single-binary, minimal-footprint intent.
- **Not a replacement for the agents, and not a general note-taking app.** Mycelium manages the context lifecycle around AI coding sessions; it does not run the coding or store free-form notes.
- **Automation stays suggestion-only.** Auto-filing and auto-tagging never overwrite a session a human has organized (`organizedBy: 'human'` is sticky).
