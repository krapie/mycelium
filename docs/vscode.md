**[← Back to README](../README.md)**

# VS Code

The `vscode/` extension puts Mycelium in the editor's sidebar. It works with VS Code, Cursor and Windsurf, reads and writes the same `~/.mycelium` store as the TUI, and covers the whole loop: scan sessions, organize them, extract folder knowledge, search and resume old sessions, start new ones.

It needs the `mycelium` CLI (`npm i -g @kevinprk/mycelium`); the extension runs `mycelium serve --stdio` and shows what it returns. The first time it activates it opens a **Get Started** walkthrough; reopen it any time with **Mycelium: Open the Guide**.

## Install

Each computer needs the **CLI (0.5.1 or newer)** and the **extension**. The extension tells you if the CLI is missing or too old.

```sh
npm install -g @kevinprk/mycelium            # or: brew install krapie/tap/mycelium   (Node ≥ 22.16)
code --install-extension krapie.mycelium-vscode           # `cursor` / `windsurf` work the same way
```

The Marketplace and Open VSX update it for you. To install a specific release instead, download its `.vsix` from the [releases page](https://github.com/krapie/mycelium/releases?q=vscode-v) and use *Extensions → `…` → Install from VSIX…* (or `code --install-extension <file>`). Each computer keeps its own `~/.mycelium`; the extension shows whatever store it finds on that machine.

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

Smart organize and knowledge extraction call your own `claude` or `codex` login (the same one the TUI uses); Mycelium never asks for an API key. Each runs as a cancellable notification; cancelling stops the in-flight CLI processes. Pressing Esc in the organize list leaves the suggestions queued, so running it again shows them instantly. A session you place by hand is never moved by a later smart organize.

To remove a session, right-click it (or use *Delete* on its page) → *Delete Session*, after a confirmation. Only Mycelium's record goes; the agent's own log stays and the session isn't captured again. Needs a CLI with `delete` support.

Knowledge updates the daemon staged overnight show as a count in the status bar; **Review Knowledge Updates** walks through them one diff at a time.

## Claude Code panel

If the [Claude Code extension](https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code) is installed, Claude sessions open in its own panel instead of a terminal:

- **Resume** on a Claude session reopens that conversation in the Claude Code panel, in a window on the session's project directory, which is also where Claude Code looks the session up.
- **Hand off** to Claude and **Start New Agent → Claude** open a new conversation there. A handoff prompt is put in the input box for you to read and send; nothing is sent for you.
- **Resume in terminal** (right-click a session, or the *In terminal* button on its page) still gives you the terminal. Other agents (Codex, Kiro, OpenCode) always use a terminal.
- The panel doesn't need a `claude` command on your `PATH`: the Claude Code extension ships its own. (A terminal does; with neither available you are told so. Needs `mycelium` CLI 0.5.1 or newer.)
- `mycelium.claudeCode.openIn` decides: `auto` (default) follows Claude Code's own `claudeCode.useTerminal` setting, `panel` and `terminal` force one.

What this doesn't do: Claude Code's own session list shows Claude's sessions, and there is no way for another extension to add Mycelium's folders or summaries to it. Browsing and organizing stay in the Mycelium sidebar, which now hands off to the panel. It uses the same entry point as Claude Code's `vscode://anthropic.claude-code/open?session=…&prompt=…` link (checked against Claude Code 2.1.296); if that ever stops working, Mycelium falls back to a terminal and tells you.

## What's on screen

- **Actions**: everything you can do, in the order you'd do it, with how much is waiting (unfiled sessions, knowledge to review). The title also shows which store the window is reading (`~/.mycelium`, or a sample store).
- **This Workspace**: sessions that ran in (or below) the folder(s) open in this window, found by the directory each session recorded; open a different folder and it changes. Not related to how you filed things.
- **Folders**: your folder tree, then **New** (not filed yet). A book icon marks folders that already have a `KNOWLEDGE.md`; the view badge counts what's still unfiled.
- **Recent**: the last 14 days, grouped Today / Yesterday / This week / Earlier. Hidden by default (it mostly repeats the two above); turn it on from the `…` menu of the Mycelium sidebar header.
- **Session page**: click any session. Summary, decisions, to-dos, changed files, and links to the sessions it continues, was merged from, or was split into. Buttons: Resume, Hand off, Copy handoff prompt, Move, Tags, Summarize, Delete. Merged/split sessions can't be resumed; the page says why. *View transcript* opens the raw conversation.
- **Backlog**: a note you write now and start later. *Add Backlog Item* (Actions, the quick menu, or a folder's right-click menu) asks for a title and optional notes. The item shows in the tree like a session; its page has *Start* and *Edit*, and the tree has a play button. *Start* picks an agent and a directory, puts the folder's knowledge into the project's AGENTS.md on a best-effort basis (no prompt), and gives the agent your note as its first prompt (in the Claude Code panel's input box for Claude). The item stays listed, marked started, until the session it began is captured on a later scan. Needs a `mycelium` CLI with backlog support (the next release after 0.5.4).
- **Calendar (experimental)**: off by default; turn on `mycelium.experimental.calendar`. *Open Calendar* (Actions, quick menu, command palette) opens a tab with a month grid, the same idea as the TUI's `v` tab: a day's shade and number are how many sessions ended on it. Click a day, or move with the arrow keys, to list that day's sessions under the grid; click one to open its page, or use Resume / Hand off. `‹` `›` change month, *Today* jumps back. Needs a `mycelium` CLI with the `calendar` method (the next release after 0.5.4).
- **Status bar**: `N here · M new`; click for a quick menu.

Agent colors (Claude, Codex, Kiro, OpenCode, merged, backlog) follow the theme and can be changed with `workbench.colorCustomizations` (`mycelium.agent.*`).

## Which window a session opens in

Sessions are tied to the directory they ran in, and you will usually have a window per project. **Resume**, **Hand off** and **Start New Agent Session** therefore open (a terminal, or the Claude Code panel for Claude sessions) in a window on that session's own directory: if this window already has the project open (or a folder inside or around it), the terminal opens here; otherwise VS Code opens a window on that directory, or switches this one, if it has no folder open, and the terminal starts there, the way a new tab would.

This hand-off needs the Mycelium extension to be **installed**, because the new window has to run it too (install it from the Marketplace or Open VSX, or `npm run install:local` in `vscode/` when developing). If the other window doesn't take the request within about 15 seconds, the session starts in the current window instead and says so. To always use the current window, set `mycelium.openSessionIn` to `thisWindow`.

## Settings

| Setting | Meaning |
|---|---|
| `mycelium.path` | The `mycelium` executable (default: from `PATH`). |
| `mycelium.home` | Data directory (`MYCELIUM_HOME`); empty uses `~/.mycelium`. |
| `mycelium.openSessionIn` | `projectWindow` (default): terminals open in a window on the session's directory. `thisWindow`: always here. |

## Troubleshooting

**"Mycelium can't find its command-line tool", but it is installed.** An editor started from the Dock or Finder doesn't always get your shell's `PATH`. When VS Code can't resolve it in time it shows *"Unable to resolve your shell environment…"*. That message is VS Code's own and the extension can't hide it. The extension looks for `mycelium` on `PATH`, then in the usual install locations (Homebrew, npm global, nvm, Volta, asdf, `%APPDATA%\npm`), then asks your login shell once, and runs it with a `PATH` that includes the CLI's own directory so `node` is found too. If it still can't: run *Mycelium: Show Log* (it lists where it looked), set `mycelium.path` to the full path (`which mycelium`), or start VS Code from a terminal with `code`.

**The "Unable to resolve your shell environment" message keeps appearing.** VS Code runs your shell as a login, interactive shell (`zsh -ilc …`) and gives up after about 10 seconds. Time it with `time zsh -ilc exit`; the usual culprits are version-manager and conda/pyenv init, prompt plugins, and anything in your rc files that asks a question.

**"…too old for this extension".** The CLI is older than the extension needs (0.5.0+): `npm install -g @kevinprk/mycelium`, then `mycelium --version`. If you also have a Homebrew copy, check which one `which mycelium` finds.

**"claude is not installed", though Claude Code is.** A terminal needs the `claude` command on `PATH`; the Claude Code *extension* has its own copy and doesn't. With the extension enabled and `mycelium` 0.5.1+, Claude sessions open in its panel without it. If `claude` is installed somewhere only your login shell knows, the extension asks the shell for its `PATH` once and sends those directories along with the request, so the CLI looks there too; *Mycelium: Show Log* records each step. Otherwise install the CLI (or start VS Code from a terminal with `code`, so it sees your `PATH`).

**"Node.js was not found".** The CLI was found but `node` isn't on the `PATH` VS Code started with: install Node.js 22.16 or newer, or start VS Code from a terminal with `code`.

## Releasing the extension (maintainers)

The extension is versioned separately from the CLI, and its releases are tagged `vscode-v<version>` so they don't collide with the CLI's `v<version>`.

1. Bump `version` in `vscode/package.json` and add a `vscode/CHANGELOG.md` entry. If the extension now needs newer CLI features, raise `MIN_CLI` in `vscode/src/version.js`, and that CLI has to be released first (`v<cli version>`, which publishes to npm and Homebrew).
2. Publish a GitHub Release with tag `vscode-v<version>` and notes. [`publish-vscode.yml`](../.github/workflows/publish-vscode.yml) checks the tag against `vscode/package.json`, runs the tests, builds `mycelium-vscode-<version>.vsix` and attaches it to the release; then two separate jobs publish **that same file** to the VS Code Marketplace and to Open VSX. `publish.yml` and `publish-homebrew.yml` skip `vscode-` tags. A pre-release GitHub Release is published as a pre-release on both registries.
3. To try the file before releasing: `cd vscode && npm run package`, then install it into a throwaway profile: `code --user-data-dir /tmp/u --extensions-dir /tmp/e --install-extension mycelium-vscode-<version>.vsix`.

### Publishing to the registries (one-time setup)

Each registry job does nothing until its token exists as a repository secret (*Settings → Secrets and variables → Actions*), so releases keep working without them; a registry you publish to by hand simply never gets a secret.

**VS Code Marketplace**: the publisher needs only a Microsoft account; how the *publishing* is authenticated is the part that is changing.
1. Sign in at <https://marketplace.visualstudio.com/manage> with a Microsoft account and create a publisher whose **ID is `krapie`** (it must match `publisher` in `vscode/package.json`).
2. Pick how releases reach it:
   - **Upload by hand** (no token, no Azure): on the publisher page choose *New extension → Visual Studio Code* and upload the release's `.vsix`. Fine for a project that releases occasionally, and the right way to do the first one.
   - **A Personal Access Token** → secret `VSCE_PAT`. Created at <https://dev.azure.com> (a free Azure DevOps organization, no Azure subscription or card): *User settings → Personal access tokens → New token*, *Organization* **All accessible organizations**, *Scopes* **Custom defined → Marketplace → Manage**. **Microsoft retires global Azure DevOps PATs on 1 December 2026**, so this only works until then; treat it as a stopgap.
   - **Trusted publishing from GitHub Actions**: `vsce publish --oidc` (in the `@vscode/vsce` 4.x this workflow pins) needs no stored secret, but requires a trusted-publishing policy for this repository and workflow on the Marketplace side. Microsoft's publishing page doesn't document it, so check whether your publisher page offers it before relying on it; if it does, the job needs `id-token: write` and `--oidc` instead of `--pat`.
   - **Microsoft Entra ID** (`--azure-credential`) is what Microsoft's docs recommend, but its documented setup is an Azure subscription, a managed identity and an Azure DevOps service connection, heavy for a GitHub-hosted project.

**Open VSX** (Cursor, Windsurf, VSCodium): secret `OVSX_PAT`
1. Sign in at <https://open-vsx.org> with GitHub, link an Eclipse Foundation account and sign the Publisher Agreement.
2. Create a token at <https://open-vsx.org/user-settings/tokens>.
3. Claim the namespace once: `npx ovsx create-namespace krapie -p <token>`.
4. Add the token as `OVSX_PAT`.

**First publication, or a retry:** *Actions → Publish VS Code extension → Run workflow* with the tag of an existing release (e.g. `vscode-v0.2.2`) publishes that release's `.vsix` to both registries; the job for a registry whose token is missing says so and skips. After the first publication a listing takes a few minutes to appear (the Marketplace scans it first).

## Try it locally

The dev scripts below (`dev`, `dev:real`, seeding) are for macOS and Linux; they aren't part of the packaged extension.


```sh
cd vscode && npm run dev        # `npm run seed -- en` for English sample data
```
Seeds an isolated store (`~/.mycelium-vscode-dev`, sample sessions from the demo personas, some unsummarized, one knowledge update pending) and opens a VS Code window with the extension loaded, configured to use this checkout's `src/cli.js`. Your real `~/.mycelium` is never touched. Remove it with `rm -rf ~/.mycelium-vscode-dev ~/.mycelium-vscode-dev-repo ~/.mycelium-vscode-dev-repo-others`. To debug, open `vscode/` in VS Code and press F5. The walkthrough images are generated by `node vscode/scripts/gen-walkthrough.mjs`.

## Protocol (version 1)

Request `{"jsonrpc":"2.0","id":1,"method":"sessions","params":{"folder":"Projects/x"}}`, response `{"jsonrpc":"2.0","id":1,"result":[...]}` or `{"error":{"code":-32000,"message":"..."}}`. Methods are the table in `src/bridge.js`: `hello`, `folders`, `sessions` (`folder`/`query`/`tags`/`date`/`dir`/`limit`), `detail`, `tags`, `scan`, `mkdir`, `move`, `tag`, `agents`, `resumeCommand`, `newCommand`, `handoff`, `dirsForFolder`, `context`, `inject`, `doctor`, `exists`, and the LLM-backed `autotag`, `organizeSuggest`, `organizeApply`, `knowledgeBuild`, `knowledgeSave`, `knowledgePending`, `knowledgePromote`, `knowledgeDismiss`, `cancel`.

Ordinary requests run one at a time in arrival order. The three that take minutes (`autotag`, `organizeSuggest`, `knowledgeBuild`) run outside that queue, so a refresh isn't stuck behind them, and report progress as id-less notifications, `{"jsonrpc":"2.0","method":"progress","params":{"token":"t7","done":3,"total":10}}`, where `token` is the one the caller put in the request's params.
