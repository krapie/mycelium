# Canopy (working name) — Session Organization Platform

*Name is provisional — chosen for the tree metaphor (a canopy is the organizing layer above individual trees/branches), distinct from Relay's flow/plumbing metaphor. Open to changing it.*

## The headline idea

Everything designed so far under "context base," "orchestration layer," etc. has one idea at the center, and this project should say it plainly instead of burying it under mechanism: **organize AI agent sessions into a navigable hierarchy, the same way you'd organize any other body of ongoing work — by client, by project, by day — and make that organization the thing that also solves context continuity, not a side effect of it.**

Previous docs (`relay/docs/CONTEXT_PLATFORM_OVERVIEW.md`, `relay/docs/ORCHESTRATION_ARCHITECTURE.md`) arrived at this from the angle of "how do we make model switching lossless." That's still true and still the mechanism, but it undersells the product: the tree of organized sessions is valuable on its own, independent of whether a switch ever happens, the same way a well-organized filing system is valuable independent of whether you ever need to hand a file to a colleague. **Session organization is the product. Lossless switching is one (important, differentiating) thing that a well-organized session tree makes possible.**

## Relationship to Relay

Relay is not replaced or absorbed — it becomes this project's **native execution core**, used as-is:

- Relay's task queue, quota-aware scheduling, coding-agent adapters (`claude.js`/`codex.js`), and git worktree lifecycle are unchanged.
- Canopy is a layer that sits **around** Relay: it owns the tree (company → project → session), the source-of-truth context store, and ancestor-path routing. It talks to Relay's existing API (`POST /api/tasks`, `GET /api/tasks/:id`, etc.) to enqueue and observe work, rather than modifying Relay's internals.
- Concretely: a "session" in Canopy's tree corresponds to one or more Relay tasks. When Canopy dispatches work, it calls Relay's API with a task description assembled from ancestor-path context; when Relay reports a task done/rate-limited, Canopy records that into the tree as part of the session's history.

This keeps Relay's already-validated, working system untouched and treats it as a dependency, not something to be rebuilt inside a bigger repo.

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│                          Canopy                              │
│                                                               │
│  Tree data model (company → project → session)                │
│  Source-of-truth context store (via Memory Provider contract)  │
│  Ancestor-path routing (assembles context for a new dispatch)   │
│  Daily digest generation (via Aux LLM Provider contract)          │
│  Web UI (channel/thread view — see prior UI design doc)             │
└──────────────┬──────────────────────────┬───────────────────────┘
               │                          │
      [calls Relay's API]        [Memory / Aux LLM Provider contracts]
               │                          │
               ▼                          ▼
     ┌─────────────────┐      ┌─────────────────────────┐
     │  Relay (unchanged) │      │  ai-memory / agentmemory  │
     │  - task queue        │      │  / mem0 / direct API-key   │
     │  - quota scheduling    │      │  (swappable, per                │
     │  - claude/codex adapters │      │   docs/ORCHESTRATION_       │
     │  - worktree/gate/PR         │      │   ARCHITECTURE.md)              │
     └─────────────────┘      └─────────────────────────┘
```

## Data model

**Tree**: `Company → Project → Session`. A session is roughly what Relay calls a task, but framed from the organizing side — it's a node with its own context, a status, and a position in the tree. (`docs/CONTEXT_PLATFORM_OVERVIEW.md` has the full rationale for why tree-shaped, ancestor-path routing over search-based routing.)

**Per-node context** (via the Memory Provider contract): each tree node can accumulate its own standing context — a company's conventions, a project's memory, a session's specific history — and every descendant inherits everything above it automatically, without a search step.

**Source-of-truth guarantee**: for any given piece of work, there is exactly one authoritative record of what happened and why, regardless of how many different models touched it. This is what makes "organize once, use forever" true instead of "organize once, hope it's still accurate."

## MVP scope

Deliberately narrow, given how much has been designed conceptually versus built:

1. **Tree CRUD** — create companies, projects, sessions; list/browse the hierarchy. No memory provider integration yet — just the structure.
2. **Relay integration** — creating a session in Canopy enqueues a task in Relay (via its existing API); Canopy polls Relay for status and records the result into the session node.
3. **One memory provider, verified first** — per `ORCHESTRATION_ARCHITECTURE.md`'s risk section, spike-test the leading candidate (ai-memory) against the Memory Provider contract *before* building the adapter, specifically confirming hook behavior in Relay's always-headless dispatch mode. Only build the real adapter once that's confirmed; otherwise fall back to the `none` no-op provider for MVP and revisit.
4. **Ancestor-path context assembly** — when Canopy enqueues a Relay task for a session, it walks the tree, pulls whatever the memory provider returns per ancestor, and prepends it to the task description Relay dispatches.
5. **Minimal UI** — the channel/thread view designed in the UI handoff doc, scoped to just: browse the tree, see session status/history, add a new session. No search, no daily digest yet — those are explicitly deferred (see below).

## Explicitly deferred past MVP

- Daily digest generation (needs real usage data across real sessions before the summarization prompt can be tuned meaningfully)
- Cross-tree search (only useful once there's enough tree depth/breadth to need it)
- Auxiliary LLM provider plugin (MVP can hardcode a direct API key for the one place an LLM call is needed, if any — no need for the routing abstraction until there's a second use case)
- Multiple memory providers side-by-side / provider switching UI — one verified provider is enough to prove the architecture

## Build phases

1. Spike: verify ai-memory's hook behavior in headless mode (blocking prerequisite for phase 3)
2. Tree data model + CRUD, no external integrations — prove the structure alone
3. Relay integration (enqueue + status polling)
4. Memory provider adapter (ai-memory, if phase 1 confirms; `none` otherwise) + ancestor-path assembly
5. Minimal UI over the above
6. Reassess: daily digest, search, and multi-provider support only after the above is real and in use

## Open questions

- **Naming.** "Canopy" is a placeholder — worth revisiting once the product is tangible rather than conceptual.
- **Repo/deployment relationship to Relay.** This plan assumes Canopy is a separate codebase that talks to Relay over its existing HTTP API (loopback, same machine, per Relay's desktop-first scoping). Worth confirming that's still the right boundary once phase 3 is underway, rather than e.g. importing Relay's modules directly.
- **What exactly is a "session" when it spans multiple Relay tasks** (e.g. a rate-limit handoff creates a new Relay task under the hood, per Relay's own `adapter_history` mechanism) — does Canopy treat that as one session node with multiple Relay-task-executions inside it, or does each Relay task get its own session node with a parent/continuation link? This affects the tree schema and hasn't been resolved yet.
