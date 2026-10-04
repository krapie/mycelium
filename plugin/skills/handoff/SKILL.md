---
description: Write a handoff prompt for this session so another agent (Codex, Kiro, OpenCode, or a fresh Claude Code) can continue the work.
disable-model-invocation: true
allowed-tools: Bash(mycelium handoff:*)
---

Mycelium composed this handoff for the current session:

!`mycelium handoff ${CLAUDE_SESSION_ID} --capture claude`

Show the user the handoff above in one fenced code block, unchanged, so it's easy to copy. Then add a short "Continuing elsewhere" note with these two ways to start, in the same directory:

- `codex "$(mycelium handoff ${CLAUDE_SESSION_ID})"` (works for any agent CLI, not just codex)
- `mycelium` (the TUI): select the session and press `h`

Do not continue the task yourself after this.
