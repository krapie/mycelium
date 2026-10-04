**[← Back to README](../README.md)**

# Claude Code plugin (PoC)

The plugin connects Mycelium to Claude Code's own lifecycle. Each new session starts already knowing what earlier sessions in the same project learned, and each finished session is captured as soon as it ends. You don't need to open the TUI for either one.

The plugin is a thin layer over the `mycelium` CLI, which you install separately. If the CLI isn't installed, the plugin does nothing.

## Install

```sh
npm install -g @kevinprk/mycelium
```

Then, inside Claude Code:

```
/plugin marketplace add krapie/mycelium
/plugin install mycelium@mycelium
```

To try a local checkout without installing it: `claude --plugin-dir ./plugin`.

## What you'll notice

**Starting a session.** When the directory belongs to a Mycelium folder, Claude Code shows one line, and Claude gets the details as context:

```
mycelium · company/platform/auth · knowledge loaded · last: "Fix token refresh race" · 1 backlog
```

Claude receives:

- the folder's inherited `KNOWLEDGE.md` chain
- the last session that ran in this directory, from any agent, with its summary and open todos
- the folder's waiting backlog items

In a directory Mycelium knows nothing about, you see nothing. Nothing is written to your repository: the briefing goes in through the hook's `additionalContext`, unlike `mycelium inject`, which edits `AGENTS.md`. The briefing is skipped on `--resume` because the transcript already contains it. It is re-sent after `/compact`.

**Ending a session.** The session is captured into `~/.mycelium` right away, so you don't wait for the next background scan. Summarizing and filing it still happen in the TUI or daemon's normal upkeep. A hook never calls an LLM.

**Slash commands:**

| Command | What it does |
|---|---|
| `/mycelium:recall <query>` | Searches past sessions from any agent and summarizes the relevant ones. Claude can also use it on its own when you mention earlier work. |
| `/mycelium:handoff` | Writes a handoff prompt for this session, so Codex, Kiro, OpenCode, or a fresh Claude Code can continue it. |
| `/mycelium:backlog [what]` | Adds a backlog item under this directory's folder, or lists the waiting items when called with no argument. |
| `/mycelium:link [folder \| --unset]` | Shows or pins which folder this directory belongs to. |

## How a directory maps to a folder

`folderForDir()` in `src/reuse.js` checks two things, in order:

1. a folder you pinned with `mycelium link <folder>` (or `/mycelium:link`), stored in `config.json` as `dirFolders`
2. otherwise, the folder of the most recent filed session (excluding `_archive`) that ran in this directory

If neither matches, it tries each parent directory in turn, stopping before `$HOME` and `/`. Starting from a subdirectory of a repository therefore still resolves.

The lookup reads the sqlite index, not `raw/`, so it stays fast on large stores. Index rows written before this version have no directory columns. Run `mycelium reindex` once after upgrading; any TUI scan that imports something does the same.

## Safety

- **No recursion.** Mycelium's own LLM calls are `claude -p` subprocesses, so they would fire these hooks too. `complete()` in `src/llm.js` marks those children with `MYCELIUM_INTERNAL=1`, and `mycelium hook` exits immediately when it sees that mark. Without it, every internal call would be captured, and the next auto-tag cycle would spawn more calls (the same runaway as issue #3).
- **Hooks never fail a session.** If `mycelium` isn't on `PATH`, the input is bad, or anything throws, the hook exits 0 with no output.
- **Time budget.** `SessionEnd` captures one session through its adapter's directory listing, without a full `scan()`. It also sets `timeout: 15` because Claude Code's default `SessionEnd` budget is 1.5 seconds.

## Layout

```
.claude-plugin/marketplace.json   this repo doubles as the plugin's marketplace
plugin/.claude-plugin/plugin.json
plugin/hooks/hooks.json           SessionStart / SessionEnd → `mycelium hook <event>`
plugin/skills/{recall,handoff,backlog,link}/SKILL.md
src/hook.js                       sessionStartContext(), captureEndedSession()
src/cli/hook.js                   `mycelium hook` (stdin JSON → hook JSON) and `mycelium link`
```

## Not yet

- An MCP server, so Claude could search past sessions mid-task without a skill. Held back by the single-dependency rule.
- Picking up a pending handoff from another agent automatically at `SessionStart`.
- Windows: the hook commands use POSIX `sh` (`command -v`).
