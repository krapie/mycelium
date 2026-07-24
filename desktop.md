# Mycelium Desktop — Electron GUI with embedded terminal sessions

## Status (this branch)

**Phase 1 done + verified live.** `npm install` in `desktop/` (needed bumping
Electron from 32→35 — 32's bundled Node predates `node:sqlite`; also needed
`npx electron-rebuild -f -w node-pty` to rebuild the native module against
Electron's ABI, not just Node's). Launched the real app via
`electron --remote-debugging-port` + drove it over the Chrome DevTools
Protocol to verify without guessing:
- Sidebar folders/session list render real data straight from `~/.mycelium`
  (matches `mycelium list`) — the whole IPC → `tui/data.js` → backend path
  works end to end.
- Clicking a real session (a Kiro one) opened a live tab and **actually
  spawned real `kiro-cli chat --resume-id ...`** via `node-pty` — confirmed
  by reading xterm's buffer directly (DOM text-scraping doesn't work, xterm
  v5 renders to canvas): the real banner/tips output showed up correctly.
- Found and fixed a real bug in the process: `openLiveTab` was passing the
  session-list row (which — like the TUI's list rows — doesn't carry
  `cwd`/`projectDir`, only the sqlite index columns) straight to `pty.start`,
  so `workDirFor()` always failed. Fixed by fetching `data.detail(id)` first,
  same as the TUI's `doResume` already does. Also swapped the error path off
  `alert()` (blocks the renderer thread) for a small non-blocking toast.
- Closing a tab kills the pty, clears DOM state, and the exit-time
  scan()+targeted-reindex ran with no errors; verified the real session's
  raw file was untouched/uncorrupted by the test afterward.
- CLI/TUI unaffected — nothing outside `desktop/` was touched.

Not yet built: new-session-launch polish (works, but the agent/dir picker is
still bare `prompt()`), organize actions (move/tag/delete/title) wired into
the sidebar, smart-organize review panel, packaging. See "Build order" below.

## Context

The TUI works, but two real limits came up: (1) "open in a new tab" currently means copying a shell command and pasting it into a terminal tab you open yourself — Mycelium has no control over actual tabs; (2) opening a session only ever shows a text summary + a resume command, never the live thing itself. Both are architectural limits of being a blessed TUI running inside whatever terminal the user already has open — a TUI can't own tabs or embed another program's live output.

**Confirmed with the user: build a real desktop app** (not terminal-automation-only), specifically Electron with an embedded terminal (`node-pty` + `xterm.js`) — this is the standard, proven stack (it's how VS Code's own integrated terminal, Warp, Hyper, and Theia all work), and it solves both problems at once: the app owns its own tabs (works the same on macOS/Linux/Windows, no per-terminal-app AppleScript automation needed), and a session opens as a live, real, interactive pty right in the app instead of a static summary.

**Key finding that makes this tractable, not a rewrite**: none of the core logic (`src/scanner.js`, `src/organize.js`, `src/learn.js`, `src/insight.js`, `src/reuse.js`, `src/daemon.js`, `src/agents.js`, `src/index-db.js`, `src/config.js`, `src/schema.js`, `src/adapters/*`) imports `neo-blessed` — verified by grep, zero hits. Only `src/tui/` is blessed-specific. The desktop app is a **new frontend on the same backend**, not a rewrite — the CLI and TUI stay exactly as they are, fully functional, unchanged.

## Architecture

New self-contained sub-package `desktop/` (own `package.json`/dependencies — `electron`, `node-pty`, `xterm`, `xterm-addon-fit`, `electron-builder` — so `npm install` for CLI-only use stays as light as it is today). Files there `import` the existing `src/*.js` modules by relative path (`../src/scanner.js` etc.) — plain Node ESM, no workspace tooling needed.

```
desktop/
  package.json
  main.js            # Electron main process: window, app lifecycle, IPC handlers
  preload.js          # contextBridge — narrow, explicit API exposed to the renderer (no nodeIntegration in renderer)
  pty.js              # spawns/manages one node-pty per open live session tab
  renderer/
    index.html
    app.js             # sidebar (folders/sessions), tab bar, xterm.js panes — vanilla JS, no framework for v1
    style.css
```

**Main process (`desktop/main.js`)** — Node context, imports the existing backend directly (zero porting):
- IPC handlers mirroring/extending `src/tui/data.js`'s surface: `folders()`, `sessions()`, `detail(id)` (read); `move`/`tag`/`deleteSession`/`setContent` (`organize.js`, mutate); `autoTagSession`/`tagAll` (`learn.js`); `suggestPlacements`/`applyPlacements`/`queueSuggestions`/`pendingSuggestions`/`clearSuggestions` (`organize.js`, same smart-organize functions built earlier this session).
- `ensureDaemonRunning()` (`src/daemon.js`, already built) called on app startup — same background upkeep as the TUI gets, reused as-is.

**PTY layer (`desktop/pty.js`)** — reuses `src/agents.js`'s existing `AGENTS`/`binFor`/`resumeArgsFor`/`workDirFor` (the exact functions `mycelium resume` and the TUI's resume flow already use) to resolve bin/args/cwd, then `node-pty.spawn(bin, args, { cwd, ... })` instead of blessed's `foreground()`/child_process. Streams pty output to the renderer over IPC (`pty:data`), takes keystrokes/resizes back (`pty:input`, `pty:resize`). On pty exit, re-`scan()`+targeted-reindex the session (same pattern `launch.js`'s `resumeSession`/`run` already established) so the transcript stays current.

**Renderer (`desktop/renderer/`)** — vanilla HTML/CSS/JS for v1 (matches the project's low-dependency instinct; revisit a framework only if UI complexity genuinely demands it later):
- Left sidebar: folder tree + session list, same mental model as the TUI's Folders/Sessions columns, backed by the same `folders()`/`sessions()` calls.
- Clicking a session **opens it as a new tab immediately in live view** — no separate "show summary, then decide to resume" step; this is the direct fix for "load the session right away." A tab hosts an `xterm.js` instance wired to that session's pty channel.
- "+" next to the tab bar → agent picker (reuses `AGENTS` labels) → folder/dir resolution (port `launch.js`'s `resolveDir` logic) → opens as a new live tab.
- Sidebar row actions (move/tag/delete/edit title) call the same IPC handlers wrapping `organize.js` — identical semantics to the TUI's `m`/`t`/`x`/`e`.
- A smart-organize panel listing `pendingSuggestions()` with checkboxes (plain DOM, same accept/skip model as the TUI's `multiSelectList`) — Apply calls `applyPlacements` + `clearSuggestions`.

## Build order (this is genuinely multi-week scope — phased, not one sitting)

1. **Electron shell + IPC skeleton** — window boots, sidebar shows real folders/sessions from `~/.mycelium` via the existing backend, read-only detail view. Proves the backend-reuse architecture end-to-end before touching pty.
2. **Live resume in a tab** — `node-pty` + `xterm.js`, wire up resuming one real session end-to-end (this is the single most-wanted capability — do it before anything else UI-polish-related).
3. **New-session launch flow** in a tab (agent picker → dir resolve → live pty).
4. **Organize actions** (move/tag/delete/title-edit) wired into the sidebar.
5. **Smart-organize review panel** + daemon pending-notice.
6. **Packaging** (`electron-builder`) → distributable `.app`.

**Scope for this session: Phase 1, and start Phase 2** (get one real resume working live in a tab) — a concrete, demoable slice rather than trying to build the whole app at once. Phases 3-6 go into `ROADMAP.md` as tracked follow-up work.

## New dependencies (explicit tradeoff, flagging it plainly)

This is a real departure from the CLI's current "neo-blessed only" footprint: `electron`, `node-pty` (native module — needs `@electron/rebuild` in the build step to match Electron's Node ABI, a known/well-documented requirement, not a novel risk), `xterm` + `xterm-addon-fit`, `electron-builder`. All scoped to `desktop/package.json`, so `npm install` at the repo root for CLI/TUI use is completely unaffected.

## Verification

1. Phase 1: launch the Electron app, confirm the sidebar's folder/session data matches `mycelium list`'s output exactly (same backend, same store).
2. Phase 2: resume a real session in a tab — confirm it's genuinely interactive (type a message, get a real response through the embedded pty), confirm closing the tab still captures/reindexes correctly (reuse the exact scan+targeted-reindex pattern already proven in `launch.js`/the perf fix this session).
3. Confirm the CLI (`mycelium list`, `mycelium resume`, etc.) and TUI (`mycelium`) still work completely unchanged after all this — they must, since nothing in `src/` outside `desktop/` gets touched.
