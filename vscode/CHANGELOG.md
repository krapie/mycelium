# Changelog

## 0.3.0

- **Backlog**: *Add Backlog Item* writes a note to start later; *Start* hands it to an agent as the first prompt, and *Edit* changes it. Backlog pages now show the notes with Start and Edit instead of disabled Resume buttons. Needs `mycelium` CLI 0.5.5.
- **Calendar (experimental)**: a month grid of sessions by day, with the chosen day's sessions underneath (open, resume, hand off). Off by default; enable `mycelium.experimental.calendar`. Needs `mycelium` CLI 0.5.5.
- **Copy Diagnostics**: *Mycelium: Copy Diagnostics* puts the extension's and the CLI's environment report on the clipboard, for bug reports. It also works when the CLI can't be found; the CLI side of the report needs `mycelium` CLI 0.5.5.

## 0.2.4

- **Delete Session**: right-click a session (or use *Delete* on its page) to remove it from Mycelium. The agent's own log is kept and the session isn't captured again. Needs `mycelium` CLI 0.5.4.
- The session page no longer lists *Files changed*.
- **Review Knowledge Updates** can accept everything at once: with more than one update waiting it first offers *Accept all* or *Review one by one*, and each diff has an *Accept all remaining* button.

## 0.2.3

- Summarize, organize and knowledge extraction now find `claude`/`codex` through the login shell's `PATH` when VS Code never received it, like opening a session already did. If the agent really isn't found, the error says `claude not installed` instead of a generic LLM failure. Needs a `mycelium` CLI with this change.

## 0.2.2

First release on the VS Code Marketplace and Open VSX.

- Renamed **Mycelium for VS Code** (the id, `krapie.mycelium-vscode`, is unchanged), with a listing icon and banner.
- The README is now the extension's page: install from the Marketplace (or `.vsix`), and a privacy statement.
- No behavior changes.

## 0.2.1

- Fixed "Mycelium: claude is not installed" for people who have the Claude Code **extension** but no `claude` command on their PATH. The extension ships its own claude, so opening a Claude session in its panel no longer needs the CLI; Claude is also offered under Hand off and Start New Agent in that case. A terminal still needs the CLI, and if neither is available you are told so instead of getting a terminal that prints "command not found". Needs `mycelium` CLI 0.5.1 for this; with 0.5.0 everything else works as before.
- When an agent still isn't found — it lives in a directory only your login shell knows, and VS Code never got your shell's `PATH` — the extension asks the login shell for its directories once and sends them along with the request, so the CLI looks there too (nothing is restarted, so a summarize or organize run in progress is not interrupted). The agent picker does the same whenever any agent is missing, not only when the list is empty.
- A command that fails is now written to **Mycelium: Show Log** (it used to show only in a notification), including what was asked of the CLI.
- A replaced CLI process can no longer fail, or feed output into, requests sent to its successor.

## 0.2.0

- **Claude Code sessions open in the Claude Code panel.** With the Claude Code extension installed, **Resume** on a Claude session reopens that conversation in its own panel (in a window on the session's project), and **Hand off** to Claude or **Start New Agent** → Claude starts a new conversation there, with the handoff prompt in the input box. *Resume in terminal* (context menu, and a button on the session page) keeps the old behavior. `mycelium.claudeCode.openIn` (`auto` / `panel` / `terminal`) chooses; `auto` follows Claude Code's own `claudeCode.useTerminal`. If the panel can't be opened, it falls back to a terminal and says so.

## 0.1.1

- Fixed "can't find the CLI" when it is installed. An editor started from the Dock doesn't always get your shell's PATH, so `mycelium` wasn't found — and even a full path failed, because the script needs `node` on PATH too. The extension now finds the CLI on PATH, in the usual install locations (Homebrew, npm global, nvm, Volta, asdf, `%APPDATA%\npm`) and, as a last resort, through your login shell, and runs it with a PATH that can find `node`.
- A CLI from before `serve` (0.4.x) is now reported as too old; it was shown as "exited (1)".
- New *Mycelium: Show Log* command and a Mycelium output channel that say where the CLI was looked for and what it printed; a missing Node.js has its own message.

## 0.1.0

First release.

- Sidebar with **Actions**, **This Workspace**, **Folders** (drag sessions onto folders) and **Recent**.
- Session page: summary, decisions, to-dos, changed files, lineage; Resume, Hand off, Move, Tags, Summarize.
- Smart organize with a review list; folder knowledge extraction with a diff before saving; review of knowledge updates prepared in the background.
- Resume, Hand off and Start New Agent open their terminal in a window on the session's own project directory.
- A Get Started walkthrough (English and Korean).
- Needs the `mycelium` CLI 0.5.0 or newer; tells you when it is missing or too old.
- Written to work on macOS, Linux and Windows (PowerShell, cmd and POSIX shells). Windows has been tested by unit tests and CI only so far.
