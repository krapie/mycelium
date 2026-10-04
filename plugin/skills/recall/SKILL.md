---
description: Search earlier AI coding sessions (Claude Code, Codex, Kiro, OpenCode) that Mycelium captured. Use when the user refers to earlier work ("last time", "like we did in…"), or before re-solving something that may already have been worked out in a past session.
argument-hint: "[query]"
allowed-tools: Bash(mycelium search:*), Bash(mycelium handoff:*), Bash(mycelium context:*)
---

Search Mycelium's store of past sessions for: $ARGUMENTS

1. Run `mycelium search "<query>"`. Each result is an 8-character id, the agent, the folder, and a title. Add `--folder <path>` to narrow to one project folder, or `--tag <t>` for a tag.
2. For the one or two results that look relevant, run `mycelium handoff <id>`. It prints that session's original request, its last reply, and the folder's knowledge.
3. Tell the user what you found in a few lines: which session, when, which agent, and what it decided or left unfinished. Then apply it to the current task. Don't paste raw command output.

If nothing matches, say so and continue without it. If `mycelium` isn't installed, tell the user to run `npm install -g @kevinprk/mycelium`.
