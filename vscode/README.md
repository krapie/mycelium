# Mycelium for VS Code

Capture, organize, learn from and reuse your AI coding-agent sessions (Claude Code, Codex, Kiro, OpenCode) from the editor's sidebar. It reads and writes the same `~/.mycelium` store as the [Mycelium](https://github.com/krapie/mycelium) TUI and CLI.

Works in VS Code, Cursor and Windsurf, on macOS, Linux and Windows.

## Requirements

- **Node.js 22.16 or newer** and the **`mycelium` CLI, version 0.5.0 or newer**: the extension runs `mycelium serve` and shows what it returns:
  ```sh
  npm install -g @kevinprk/mycelium        # or: brew install krapie/tap/mycelium
  mycelium --version
  ```
- At least one agent CLI (`claude`, `codex`, …) for Resume / Hand off / New Agent, and for the AI steps (summarize, smart organize, folder knowledge), which use your own login.

## Install

Search for **Mycelium for VS Code** in the Extensions panel, or:

```sh
code --install-extension krapie.mycelium-vscode        # cursor / windsurf too
```

It is also on [Open VSX](https://open-vsx.org/extension/krapie/mycelium-vscode) (what Cursor, Windsurf and VSCodium use), and every release has its `.vsix` on [GitHub](https://github.com/krapie/mycelium/releases?q=vscode-v) for *Extensions → `…` → Install from VSIX…*.

## Getting started

The **Get Started** walkthrough opens the first time (reopen it with *Mycelium: Open the Guide*). In short, open the Mycelium icon in the activity bar and use **Actions**: scan for sessions, summarize them, smart-organize them into folders, extract a folder's knowledge, search, and start or resume sessions. Full guide: [docs/vscode.md](https://github.com/krapie/mycelium/blob/main/docs/vscode.md).

With the Claude Code extension installed, Claude sessions open in its panel instead of a terminal (`mycelium.claudeCode.openIn`; *Resume in terminal* keeps the terminal). Resume, Hand off and Start New Agent open in a window on the session's own project directory (this needs the extension installed in that window too; set `mycelium.openSessionIn` to `thisWindow` to always use the current one).

## Settings

| Setting | |
|---|---|
| `mycelium.path` | The `mycelium` executable (default: from `PATH`). |
| `mycelium.home` | Data directory (`MYCELIUM_HOME`); empty uses `~/.mycelium`. |
| `mycelium.openSessionIn` | `projectWindow` (default) or `thisWindow`. |

## Troubleshooting

**"Mycelium can't find its command-line tool", but it is installed.** An editor started from the Dock or Finder doesn't always get your shell's `PATH`. When VS Code can't resolve it in time it shows *"Unable to resolve your shell environment…"*. That message is VS Code's own and the extension can't hide it. The extension looks for `mycelium` on `PATH`, then in the usual install locations (Homebrew, npm global, nvm, Volta, asdf, `%APPDATA%\npm`), then asks your login shell once, and runs it with a `PATH` that includes the CLI's own directory so `node` is found too. If it still can't: run *Mycelium: Show Log* (it lists where it looked), set `mycelium.path` to the full path (`which mycelium`), or start VS Code from a terminal with `code`.

**The "Unable to resolve your shell environment" message keeps appearing.** VS Code runs your shell as a login, interactive shell (`zsh -ilc …`) and gives up after about 10 seconds. Time it with `time zsh -ilc exit`; the usual culprits are version-manager and conda/pyenv init, prompt plugins, and anything in your rc files that asks a question.

**"…too old for this extension".** The CLI is older than the extension needs (0.5.0+): `npm install -g @kevinprk/mycelium`, then `mycelium --version`. If you also have a Homebrew copy, check which one `which mycelium` finds.

**"Node.js was not found".** The CLI was found but `node` isn't on the `PATH` VS Code started with: install Node.js 22.16 or newer, or start VS Code from a terminal with `code`.

## Privacy

No telemetry, no accounts, no network calls of its own. It runs the `mycelium` CLI on your machine and shows what it returns; sessions stay in `~/.mycelium`. The AI steps (summarize, smart organize, folder knowledge) and Resume / Hand off / Start New Agent run *your* `claude`, `codex` etc. under *your* login, and so send session content to that provider exactly as using it directly does. The extension only runs in folders you trust.

## Using several computers

Each computer has its own `~/.mycelium`; the extension shows whatever store it finds on that machine.
