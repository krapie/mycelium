# Mycelium for VS Code

Capture, organize, learn from and reuse your AI coding-agent sessions (Claude Code, Codex, Kiro, OpenCode) from the editor's sidebar. It reads and writes the same `~/.mycelium` store as the [Mycelium](https://github.com/krapie/mycelium) TUI and CLI.

Works in VS Code, Cursor and Windsurf, on macOS, Linux and Windows.

## Requirements

- **Node.js 22.16 or newer** and the **`mycelium` CLI, version 0.5.0 or newer** — the extension runs `mycelium serve` and shows what it returns:
  ```sh
  npm install -g @kevinprk/mycelium        # or: brew install krapie/tap/mycelium
  mycelium --version
  ```
- At least one agent CLI (`claude`, `codex`, …) for Resume / Hand off / New Agent, and for the AI steps (summarize, smart organize, folder knowledge), which use your own login.

## Install

Download the `.vsix` from the [latest extension release](https://github.com/krapie/mycelium/releases?q=vscode-v) and install it:

```sh
gh release download vscode-v0.1.0 -R krapie/mycelium -p '*.vsix'
code --install-extension mycelium-vscode-0.1.0.vsix        # cursor / windsurf work the same way
```

or *Extensions* → `…` → *Install from VSIX…*. To update, install the newer file the same way.

## Getting started

The **Get Started** walkthrough opens the first time (reopen it with *Mycelium: Open the Guide*). In short, open the Mycelium icon in the activity bar and use **Actions**: scan for sessions, summarize them, smart-organize them into folders, extract a folder's knowledge, search, and start or resume sessions. Full guide: [docs/vscode.md](https://github.com/krapie/mycelium/blob/main/docs/vscode.md).

Resume, Hand off and Start New Agent open their terminal in a window on the session's own project directory (this needs the extension installed in that window too; set `mycelium.openSessionIn` to `thisWindow` to always use the current one).

## Settings

| Setting | |
|---|---|
| `mycelium.path` | The `mycelium` executable (default: from `PATH`). |
| `mycelium.home` | Data directory (`MYCELIUM_HOME`); empty uses `~/.mycelium`. |
| `mycelium.openSessionIn` | `projectWindow` (default) or `thisWindow`. |

## Using several computers

Each computer has its own `~/.mycelium`; the extension shows whatever store it finds on that machine.
