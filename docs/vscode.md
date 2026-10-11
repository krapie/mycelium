**[← Back to README](../README.md)**

# VS Code

The `vscode/` extension puts Mycelium in the editor's sidebar. It works with VS Code, Cursor and Windsurf, reads and writes the same `~/.mycelium` store as the TUI, and covers the whole loop: scan sessions, organize them, extract folder knowledge, search and resume old sessions, start new ones.

It needs the `mycelium` CLI (`npm i -g @kevinprk/mycelium`) — the extension runs `mycelium serve --stdio` and shows what it returns. The first time it activates it opens a **Get Started** walkthrough; reopen it any time with **Mycelium: Open the Guide**.

## Install

Each computer needs the **CLI (0.5.0 or newer)** and the **extension**. The extension tells you if the CLI is missing or too old.

```sh
npm install -g @kevinprk/mycelium            # or: brew install krapie/tap/mycelium   (Node ≥ 22.16)
gh release download vscode-v0.1.0 -R krapie/mycelium -p '*.vsix'
code --install-extension mycelium-vscode-0.1.0.vsix     # `cursor` / `windsurf` work the same way
```

Or download the `.vsix` from the release page and use *Extensions → `…` → Install from VSIX…*. The extension is not on a marketplace yet, so there is no auto-update: install the newer `.vsix` to update. Each computer keeps its own `~/.mycelium`; the extension shows whatever store it finds on that machine.

On Windows the terminal command is written for whichever shell the integrated terminal uses (PowerShell, cmd or bash). cmd has no safe way to quote an arbitrary handoff prompt, so when the terminal's shell is cmd and an argument isn't made of plain words, that one terminal opens in PowerShell instead.

## Using it: the loop, step by step

| Stage | What you want | Where |
|---|---|---|
| **Capture** | Pull in sessions from Claude Code, Codex, Kiro, OpenCode | **Actions → Scan for new sessions**. New sessions land under **New**. |
| **Learn** | Give sessions a title, tags, summary, decisions, to-dos | **Actions → Summarize sessions** for a batch of 25, or right-click a session → *Summarize*. |
| **Organize** | File sessions into folders | **Actions → Smart organize** (or right-click a folder to scope it): tick the suggestions you agree with. Or drag sessions onto folders. |
| **Learn** | Write down what a folder's sessions decided | Right-click a folder → *Extract Folder Knowledge*. A diff against the current `KNOWLEDGE.md` opens; *Save* writes it. |
| **Find** | Get back to an old session | Search icon → type anything you remember. Results show the matching text; ▶ and ⇄ act on a result directly. |
| **Reuse** | Continue it | Hover a session → ▶ *Resume* (opens a terminal tab running the agent's own resume), or ⇄ *Hand off* to a different agent with the context carried over. |
| **Reuse** | Start fresh, already informed | Right-click a folder → *Start New Agent Session*. It offers to inject the folder's knowledge into the project's `AGENTS.md` first. |

Smart organize and knowledge extraction call your own `claude` or `codex` login (the same one the TUI uses) — Mycelium never asks for an API key. Each runs as a cancellable notification; cancelling stops the in-flight CLI processes. Pressing Esc in the organize list leaves the suggestions queued, so running it again shows them instantly. A session you place by hand is never moved by a later smart organize.

Knowledge updates the daemon staged overnight show as a count in the status bar; **Review Knowledge Updates** walks through them one diff at a time.

## What's on screen

- **Actions** — everything you can do, in the order you'd do it, with how much is waiting (unfiled sessions, knowledge to review). The title also shows which store the window is reading (`~/.mycelium`, or a sample store).
- **This Workspace** — sessions that ran in (or below) the folder(s) open in this window, found by the directory each session recorded; open a different folder and it changes. Not related to how you filed things.
- **Folders** — your folder tree, then **New** (not filed yet). A book icon marks folders that already have a `KNOWLEDGE.md`; the view badge counts what's still unfiled.
- **Recent** — the last 14 days, grouped Today / Yesterday / This week / Earlier. Hidden by default (it mostly repeats the two above); turn it on from the `…` menu of the Mycelium sidebar header.
- **Session page** — click any session. Summary, decisions, to-dos, changed files, and links to the sessions it continues, was merged from, or was split into. Buttons: Resume, Hand off, Copy handoff prompt, Move, Tags, Summarize. Merged/split sessions and backlog items can't be resumed; the page says why. *View transcript* opens the raw conversation.
- **Status bar** — `N here · M new`; click for a quick menu.

Agent colors (Claude, Codex, Kiro, OpenCode, merged, backlog) follow the theme and can be changed with `workbench.colorCustomizations` (`mycelium.agent.*`).

## Which window a session opens in

Sessions are tied to the directory they ran in, and you will usually have a window per project. **Resume**, **Hand off** and **Start New Agent Session** therefore open their terminal in a window on that session's own directory: if this window already has the project open (or a folder inside or around it), the terminal opens here; otherwise VS Code opens a window on that directory — or switches this one, if it has no folder open — and the terminal starts there, the way a new tab would.

This hand-off needs the Mycelium extension to be **installed**, because the new window has to run it too (`npm run install:local` in `vscode/`). If the other window doesn't take the request within about 15 seconds, the session starts in the current window instead and says so. To always use the current window, set `mycelium.openSessionIn` to `thisWindow`.

## Settings

| Setting | Meaning |
|---|---|
| `mycelium.path` | The `mycelium` executable (default: from `PATH`). |
| `mycelium.home` | Data directory (`MYCELIUM_HOME`); empty uses `~/.mycelium`. |
| `mycelium.openSessionIn` | `projectWindow` (default): terminals open in a window on the session's directory. `thisWindow`: always here. |

## Releasing the extension (maintainers)

The extension is versioned separately from the CLI, and its releases are tagged `vscode-v<version>` so they don't collide with the CLI's `v<version>`.

1. Bump `version` in `vscode/package.json` and add a `vscode/CHANGELOG.md` entry. If the extension now needs newer CLI features, raise `MIN_CLI` in `vscode/src/version.js` — and that CLI has to be released first (`v<cli version>`, which publishes to npm and Homebrew).
2. Publish a GitHub Release with tag `vscode-v<version>` and notes. [`publish-vscode.yml`](../.github/workflows/publish-vscode.yml) checks the tag against `vscode/package.json`, runs the tests, builds `mycelium-vscode-<version>.vsix` and attaches it to the release. `publish.yml` and `publish-homebrew.yml` skip `vscode-` tags.
3. To try the file before releasing: `cd vscode && npm run package`, then install it into a throwaway profile: `code --user-data-dir /tmp/u --extensions-dir /tmp/e --install-extension mycelium-vscode-<version>.vsix`.

## Try it locally

The dev scripts below (`dev`, `dev:real`, seeding) are for macOS and Linux; they aren't part of the packaged extension.


```sh
cd vscode && npm run dev        # `npm run seed -- en` for English sample data
```
Seeds an isolated store (`~/.mycelium-vscode-dev`, sample sessions from the demo personas — some unsummarized, one knowledge update pending) and opens a VS Code window with the extension loaded, configured to use this checkout's `src/cli.js`. Your real `~/.mycelium` is never touched. Remove it with `rm -rf ~/.mycelium-vscode-dev ~/.mycelium-vscode-dev-repo ~/.mycelium-vscode-dev-repo-others`. To debug, open `vscode/` in VS Code and press F5. The walkthrough images are generated by `node vscode/scripts/gen-walkthrough.mjs`.

## Protocol (version 1)

Request `{"jsonrpc":"2.0","id":1,"method":"sessions","params":{"folder":"Projects/x"}}`, response `{"jsonrpc":"2.0","id":1,"result":[...]}` or `{"error":{"code":-32000,"message":"..."}}`. Methods are the table in `src/bridge.js`: `hello`, `folders`, `sessions` (`folder`/`query`/`tags`/`date`/`dir`/`limit`), `detail`, `tags`, `scan`, `mkdir`, `move`, `tag`, `agents`, `resumeCommand`, `newCommand`, `handoff`, `dirsForFolder`, `context`, `inject`, `exists`, and the LLM-backed `autotag`, `organizeSuggest`, `organizeApply`, `knowledgeBuild`, `knowledgeSave`, `knowledgePending`, `knowledgePromote`, `knowledgeDismiss`, `cancel`.

Ordinary requests run one at a time in arrival order. The three that take minutes (`autotag`, `organizeSuggest`, `knowledgeBuild`) run outside that queue, so a refresh isn't stuck behind them, and report progress as id-less notifications — `{"jsonrpc":"2.0","method":"progress","params":{"token":"t7","done":3,"total":10}}` — where `token` is the one the caller put in the request's params.
