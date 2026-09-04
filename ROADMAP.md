# Roadmap

Where Mycelium is headed, and what it is deliberately not going to become. Every item traces to an open GitHub issue or a recorded in-flight decision (`AGENTS.md`'s "진행 중인 작업 및 결정사항" section); the source is named in each entry. Horizons are relative — **Now / Next / Later** — not dated. Mycelium has not committed to release quarters or version numbers for anything below.

Design principles ([`docs/architecture.md`](./docs/architecture.md) — local-only, model-agnostic, human-first, minimal dependencies) are the filter every item is checked against. The [Non-goals](#non-goals) section states what those principles rule out.

## Where things stand

v0.3.2, still a POC. All four lifecycle stages (Capture → Organize → Learn → Reuse) run against real local sessions from Claude Code, Codex, Kiro, and OpenCode. The TUI (`neo-blessed`) and CLI are thin callers over a shared core; the core API boundary is already shaped for a third interface to reuse the same modules ([`docs/architecture.md`](./docs/architecture.md#core-api-boundary)). Full current capability inventory with test-coverage status: [`docs/features.md`](./docs/features.md).

## Now

- **LLM output quality** ([#70](https://github.com/krapie/mycelium/issues/70)). A prompt pass across `learn.js` / `organize/classify.js` / `insight.js` / `split.js` has landed — tighter output contracts, real filled-in few-shot examples, bounded prompt material, forbidden meta-commentary guards. Remaining: `scripts/eval-prompts.js` is a manual real-model eval harness; the work is to actually measure output quality against live model responses (not just the mocked plumbing already covered by tests) and keep tuning. Matters more than usual because the default model is deliberately small and cheap (`haiku`), so prompt quality is the main quality lever.
- **LLM backend provider coverage** ([#86](https://github.com/krapie/mycelium/issues/86)). Lazy provider resolution has landed — `complete()` picks the first installed CLI whose adapter defines `headlessArgs()`, with clear errors instead of a raw `spawn claude ENOENT` when none is usable. All four adapters qualify — `kiro-cli` and `opencode` both turned out to have real non-interactive modes. Remaining: `kiro` is the weak one. It has no structured output mode at all, so its reply is recovered from rendered terminal text (ANSI stripped, markdown fences already consumed by its renderer); it sits last in the registry for that reason, and a structured output mode would let it move up.
- **TUI mouse behavior** ([#68](https://github.com/krapie/mycelium/issues/68)). Click responds to some things (list-row select) and not others, with no `.on('click')` wiring anywhere and nothing written down. Audit every panel/widget, then either document mouse as intentionally scoped (click selects, keys act) in [`docs/tui.md`](./docs/tui.md) or extend click coverage consistently. Needs a manual pass first — the e2e suite only drives real keypresses.
- **i18n keybinding decision** ([#44](https://github.com/krapie/mycelium/issues/44)). Decide and document whether TUI keybindings stay identical across `ko`/`en` or localize per locale (currently identical, only labels are localized). The same "is non-chrome text localized?" question extends to CLI output strings — roughly a third are hardcoded Korean regardless of `mycelium lang` ([`docs/features.md`](./docs/features.md), CLI section).

## Next

- **Broader agent coverage.** Extend `src/adapters/` past `claude` / `codex` / `kiro` / `opencode` to open-weight agent CLIs (Qwen, Gemini). Each is one adapter file implementing `base.js`'s contract plus a registry entry; scanning, resume, launch, and the TUI picker all derive automatically. Source: `AGENTS.md` decisions ("오픈웨이트 에이전트 어댑터"). OpenCode capture already shipped ([#78](https://github.com/krapie/mycelium/issues/78)); the OpenCode/Kiro LLM-*backend* side is tracked under [#86](https://github.com/krapie/mycelium/issues/86) above.
- **Claude Code plugin.** A `SessionStart` hook that detects a Mycelium install and surfaces the existing `search()` / `resumeCommandLine()` paths into a Claude Code session. Global `npm install -g` stays opt-in and user-confirmed, never auto-run. Source: `AGENTS.md` decisions ("Claude Code 플러그인").

## Later

Real directions with an issue behind them, but larger and not yet scheduled; sequencing depends on the interface questions above settling first.

- **GUI platform alongside the TUI** ([#38](https://github.com/krapie/mycelium/issues/38); also `AGENTS.md` decisions, "GUI 플랫폼 확장"). A separate surface over the same local `~/.mycelium/` store — drag-and-drop folder organization, multi-pane session/knowledge previews, native tabs for new agent sessions, and other affordances a terminal can't do well. The TUI stays the primary, reference interface. Local-only and minimal-dependencies still bind: no cloud backend, no account.
- **Port from the Node PoC to Go** ([#52](https://github.com/krapie/mycelium/issues/52)). Single static binary, no Node/`npm` runtime requirement, on an actively maintained TUI stack (`bubbletea`/`tview` — the k9s lineage already cited as this project's architectural reference). Same lifecycle, data model, and `~/.mycelium/` layout. The Node/`neo-blessed` version stays the validated behavior reference during any port, not discarded up front.

## Non-goals

Derived from [`docs/architecture.md`](./docs/architecture.md)'s principles. Naming these is a design decision, not a missing feature.

- **No hosted service, Mycelium-owned server, or account system.** The store is local (`~/.mycelium/`, or `MYCELIUM_HOME`). Moving it between machines is a manual copy of `raw/` + `tree/` followed by `mycelium reindex` — not a sync service.
- **No telemetry, analytics, or phone-home.** The only outbound traffic is the LLM calls (organize/autotag/knowledge/split), which send selected session content to whichever CLI/provider the user already configured — the same as using that CLI directly.
- **No separate API key or credential.** `complete()` rides the user's existing `claude` / `codex` / `kiro` / `opencode` subscription. Anything that would require a dedicated paid key gets flagged as a principle deviation and decided explicitly, not adopted silently ([#86](https://github.com/krapie/mycelium/issues/86)).
- **No bundled or embedded model, no vendor lock-in.** Storage stays a neutral schema, never one agent's session format; adding an agent stays one adapter file.
- **No heavy dependency stack.** The TUI holds at a single runtime dependency (`neo-blessed`). A Go port would change the language and TUI library, not the single-binary, minimal-footprint intent.
- **Not a replacement for the agents, and not a general note-taking app.** Mycelium manages the context lifecycle around AI coding sessions; it does not run the coding or store free-form notes.
- **Automation stays suggestion-only.** Auto-filing and auto-tagging never overwrite a session a human has organized (`organizedBy: 'human'` is sticky).
