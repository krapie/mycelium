**[← Back to README](../README.md)**

# Handoff Lifecycle (continuing across models)

Claude Code, Codex, Kiro, and OpenCode each store sessions in a different format, so a handoff (`h`) across vendors always creates a **new session**. That is intentional, not a bug. To continue the exact same session on the same agent, use `r` (resume) instead: `r` continues the original session itself, only possible on the same agent, while `h` always opens a new session on a different agent, or even the same one if you are handing back.

```text
Claude session A ──h(handoff)──▶ Codex session B ──h(handoff)──▶ Claude session C
   (done, preserved)                (done, preserved)                (in progress)
```

Sessions keep branching across multiple round trips, but converge back together two ways:

1. **Chain links.** Each hop is bidirectionally linked via
   `continuationOf`/`continuedTo`, shown as `↩`/`→` markers in the list
   and "continued from/to" links in detail. They are tracked as one flow,
   not disconnected sessions.
2. **Convergence through folder knowledge.** The real merge point is not an individual session file, it is the folder's `KNOWLEDGE.md`. Pressing `w` compiles the summaries and decisions of every session in that folder, regardless of agent, into one document, which gets auto-injected into `AGENTS.md` the next time an agent launches in that folder (`n`/`h`). Resuming with `r` continues the same session and log, so there's no new agent process to inject into.

## Recommended order before a return handoff (B→C)

1. `a`. If the session you are handing off (B) has no summary yet, generate one first. The handoff prompt always carries the original request, working directory, last message, and any inherited folder knowledge; `summary`, `decisions`, and `todos` are included only when present, so without `a` first, the next agent starts without them.
2. `w`. Refresh the folder's knowledge. The `AGENTS.md` injected when the
   next agent starts reflects `KNOWLEDGE.md` as of this moment.
3. `h`. Hand off from B, pick whichever agent you want, for example
   Claude Code.

## What happens to the previous session (A)?

It is not abandoned, it is done and preserved:
- The original session log stays put for now, and you can reopen it
  exactly as it was with `r` — as long as the source agent hasn't pruned
  it yet (see below; `h` does not share this dependency).
- Any code or file changes A made already exist on disk in the repo, so
  they do not disappear when the conversation thread moves on.
- A's summary and decisions are already saved in Mycelium, and `w` folds
  them into the folder's knowledge.
- A does become a branch that stopped at that point, though. Further work
  has to continue in C, or the next resume, and typing into A again later
  will not know about anything that happened in C.

## Outliving the source agent's own retention

Agent CLIs don't keep session history forever. Claude Code, for example, deletes `.jsonl` transcripts older than `cleanupPeriodDays` (30 days by default, `~/.claude/settings.json`); cleanup runs on every launch, not on a background timer, and there is no recycle bin once a transcript is gone. Other agents apply their own retention policies. This is not a Mycelium bug to work around, it is just what session storage upstream looks like, and it creates a real split between Mycelium's two continuation paths:

- `r` (resume) shells out to the source agent's own `--resume <sessionId>`. It genuinely needs that original file to still exist, so once the source agent prunes it, `r` on that session stops working, permanently.
- `h` (handoff), and the folder knowledge `n` injects into a fresh `AGENTS.md`, are both built from Mycelium's own data — `raw/<id>.json` plus `KNOWLEDGE.md` — captured once, in full, at scan (`s`) time. Neither ever reads the original transcript again, so both keep working long after the source agent has cleaned its copy up.

The practical takeaway: scanning (`s`) is what fixes a session's context in Mycelium, independent of the source agent's own clock. The sooner a finished session gets scanned, the less it matters what that agent's retention window later does to its own copy — `h` and the knowledge it carries forward are already safe.
