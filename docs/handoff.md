**[← Back to README](../README.md)**

# Handoff Lifecycle (continuing across models)

Claude Code, Codex, Kiro, and OpenCode each store sessions in a different
format, so a handoff (`h`) across vendors always creates a **new
session**. That is intentional, not a bug. To continue the exact same session on the same
agent, use `r` (resume) instead: `r` continues the original session
itself, only possible on the same agent, while `h` always opens a new
session on a different agent, or even the same one if you are handing
back.

```
Claude session A ──h(handoff)──▶ Codex session B ──h(handoff)──▶ Claude session C
   (done, preserved)                (done, preserved)                (in progress)
```

Sessions keep branching across multiple round trips, but converge back
together two ways:

1. **Chain links.** Each hop is bidirectionally linked via
   `continuationOf`/`continuedTo`, shown as `↩`/`→` markers in the list
   and "continued from/to" links in detail. They are tracked as one flow,
   not disconnected sessions.
2. **Convergence through folder knowledge.** The real merge point is not
   an individual session file, it is the folder's `KNOWLEDGE.md`.
   Pressing `w` compiles the summaries and decisions of every session in
   that folder, regardless of agent, into one document, which gets auto
   injected into `AGENTS.md` the next time an agent launches in that
   folder (`n`/`h`/`r`).

## Recommended order before a return handoff (B→C)

1. `a`. If the session you are handing off (B) has no summary yet,
   generate one first. The handoff prompt carries `extracted.summary`,
   `decisions`, and `todos` directly, so without it you get a thin
   handoff based only on the raw first and last message.
2. `w`. Refresh the folder's knowledge. The `AGENTS.md` injected when the
   next agent starts reflects `KNOWLEDGE.md` as of this moment.
3. `h`. Hand off from B, pick whichever agent you want, for example
   Claude Code.

## What happens to the previous session (A)?

It is not abandoned, it is done and preserved:
- The original `.jsonl` log stays put, and you can always reopen it
  exactly as it was with `r`.
- Any code or file changes A made already exist on disk in the repo, so
  they do not disappear when the conversation thread moves on.
- A's summary and decisions are already saved in Mycelium, and `w` folds
  them into the folder's knowledge.
- A does become a branch that stopped at that point, though. Further work
  has to continue in C, or the next resume, and typing into A again later
  will not know about anything that happened in C.
