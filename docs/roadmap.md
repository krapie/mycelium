**[← Back to README](../README.md)**

# Roadmap

Where Mycelium is headed, and — just as importantly — where it's deliberately *not* headed. Written down so a design decision doesn't have to be re-litigated from scratch every time a similar-looking competitor comes up.

## Where Mycelium sits today

As of mid-2026, a wave of open-source "agent orchestrator" tools has grown up around git worktrees and parallel AI coding agents — Claude Squad, Baton, Vibe Kanban, Worktrunk, Composio Agent Orchestrator, among others (see [Augment Code's survey](https://www.augmentcode.com/tools/open-source-agent-orchestrators) and [Nimbalyst's](https://nimbalyst.com/blog/best-tools-for-running-parallel-ai-coding-agents/)). Their common pattern: isolate each agent in its own git worktree, run several in parallel (often via tmux), and let a human act as coordinator reviewing diffs — a practice some call ["agentmaxxing"](https://codex.danielvaughan.com/2026/04/11/agentmaxxing-parallel-multi-cli-orchestration/). Separately, platforms like [QM](https://github.com/yc-software/qm) target a different tier entirely — org-wide, multi-tenant, Slack/web-deployed agent infrastructure with its own hosting story.

Mycelium is neither of those. It doesn't host or multiplex live agent sessions, and it isn't a deployment platform. Its job is **context lifecycle management**: capture what every agent CLI already produced, organize it, extract durable project knowledge from it, and feed that knowledge forward into the next session — regardless of which agent runs it, and regardless of how long ago the original session happened. None of the worktree-orchestrator tools above do any of that; their concern ends when the agent's run ends. That's a real, defensible niche, not a smaller version of what they do.

That said, the comparison surfaced two concrete, addressable gaps — not in what Mycelium remembers, but in how fast and how safely it lets someone *start* work:

1. **No one-command launch outside the TUI.** The fastest path to a new agent session today is `mycelium` → enter the TUI → move focus to Sessions → `n` → pick an agent → confirm a directory. Tools like Claude Squad get a session running in one shell command.
2. **No worktree isolation.** `Shift+N` (new session, copy the launch command instead of running it here) already unblocks running a second agent in a second terminal tab, but both agents still share the same working directory — nothing stops them from colliding on the same files. This is the single most-used mechanism across every competitor surveyed above.

## Non-goals

Explicitly out of scope, and unlikely to change without a strong new reason:

- **A hosted/multi-tenant platform** (Slack app, web dashboard, org-wide deployment) — QM's tier, not Mycelium's. Mycelium stays local-first, reading/writing a plain-file store under `~/.mycelium/` on the machine it runs on.
- **Owning tmux/terminal-multiplexing session management** — Claude Squad's core mechanism. Mycelium can hand off a ready-to-run command (as `Shift+N` already does) without taking on the job of hosting and supervising the sessions themselves.
- **Shrinking the Learn/Reuse side to chase orchestrator feature parity.** KNOWLEDGE.md extraction, AGENTS.md injection, merge/split lineage, and cross-agent handoff are the actual differentiator versus every tool named above — none of them touch a session once it ends. Feature work here should add to that story, not trade it away for a "me too" worktree feature.

## Planned phases

Each phase is meant to be independently shippable (its own branch + PR), additive to the existing architecture (`launch.js`'s `launchAgent()`, the adapter registry in `src/agents.js`, the copy-command mechanism from `Shift+N`), and consistent with the core's zero-runtime-dependency principle (`docs/architecture.md`) — a worktree feature, for instance, only ever needs `git worktree` via `child_process`, never a new package.

### Phase 1 — One-command launch outside the TUI

Add `mycelium new [folder]` as a real CLI subcommand, not just a TUI key. Reuses `launch.js`'s existing `launchAgent()` flow (agent picker → directory resolution → AGENTS.md injection → foreground handoff) so there's no second implementation to keep in sync — the TUI's `n`/`Shift+N` keys and this new subcommand end up calling the same core function with a different front end.

```
# Before
$ mycelium
  (enter the TUI → → to Sessions → n → pick agent from menu → confirm directory)

# After
$ mycelium new company/platform/auth
? Pick an agent: Claude Code
✓ Injected AGENTS.md context (3 ancestor folders)
→ launching claude in ~/projects/auth...
```

Lowest cost of the three feature phases, and everything after it builds on the same command.

### Phase 2 — git worktree isolation

Add a `--worktree` flag to `mycelium new` (and the TUI's `n`/`Shift+N`). On launch, runs `git worktree add ../<repo>-worktrees/<slug> <branch>` via `child_process`, launches the agent there instead of the shared working directory, and records the worktree path on the session (a new `worktreePath` field) so `mycelium cleanup` can offer to prune it later once the session is done.

```
$ mycelium new company/platform/auth --worktree
✓ Created worktree at ~/projects/auth-worktrees/fix-login (branch: agent/fix-login)
? Pick an agent: Codex
→ launching codex in ~/projects/auth-worktrees/fix-login...
```

This is the highest-impact gap versus every competitor surveyed — it's the one mechanism all of them share.

### Phase 3 — Parallel spawn

`mycelium spawn <folder> --agents claude,codex [--worktree]` — launch several agents at once, each isolated (if `--worktree` is set). Builds on Phase 1 + 2 plus the copy-command mechanism already shipped for `Shift+N`: rather than Mycelium taking on tmux/session-multiplexing itself (a deliberate non-goal above), this prints N ready-to-paste commands, or opens N terminal tabs sequentially where the platform allows it — coordination stays outside Mycelium's process.

### Phase 4 — Trim the keybinding surface for new users

The TUI's keymap has grown past 20 bindings across Capture/Organize/Learn/Reuse/merge/split. `?` (full shortcut list) stays as-is, but first-run-facing surfaces (onboarding, README, `docs/tui.md`'s summary table) should distinguish a small "core" set from "advanced" — so a new user's first impression is a handful of keys, not the full reference table.

### Phase 5 — MCP server (already designed, separate track)

The read-only MCP server designed in an earlier planning session (`src/mcp/` — `mycelium_search`, `mycelium_get_context`, `mycelium_resume_command`, etc.) is a natural complement to this roadmap rather than a rewrite of it: several orchestrators in the survey above (Vibe Kanban) already speak MCP, so exposing Mycelium's context layer as MCP tools lets it plug into that ecosystem instead of competing head-on with it. Tracked and scoped separately; not redesigned here.

## Status

Not yet started — this document exists to fix the direction before implementation begins. See the project's standing workflow (branch → PR per change, `npm run lint && npm test` clean, `docs/features.md` updated in the same change) once any phase above is picked up.
