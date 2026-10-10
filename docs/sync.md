**[← Back to README](../README.md)**

# Sync Across Machines

Mycelium keeps its store on one machine by default. Sync lets several machines, for example a laptop and an always-on home server, share one store: sessions captured on either show up on both, a backlog written on one can be started on the other, and a session started on one can be continued on the other through a handoff.

Sync uses `git`, run by Mycelium itself. You set it up once per machine; after that the TUI and the daemon keep it in sync in the background. There is no Mycelium-run server: the central copy is a git repository you host (a home server, a NAS, or a private repo on a git host).

## Setup

On the machine that holds the central copy, usually the always-on one:

```sh
mycelium sync host ~/mycelium.git          # create the central repo
mycelium sync init ~/mycelium.git --worker # this machine's store syncs with it, and runs LLM upkeep
```

On every other machine:

```sh
mycelium sync init ssh://you@homeserver/~/mycelium.git
```

The first sync merges the store that machine already had with the central one. Session ids come from each agent and don't collide, so two stores that grew separately combine into one.

Sync runs every 2 minutes (`MYCELIUM_SYNC_MS`) while the TUI or `mycelium daemon` is running. Run it by hand with `mycelium sync`; check it with `mycelium sync status`. Background sync never asks for an ssh password, so use an ssh key the machine can use non-interactively.

## One machine runs the LLM upkeep

Automatic summarizing, smart organize, digests, and knowledge review run on the `--worker` machine only, including for sessions captured elsewhere. Otherwise every machine would pay for the same LLM calls and write competing results. The other machines capture and sync automatically; the manual keys (`a`, `o`, `w`, `k`, `d`) work everywhere. Change it with `mycelium sync worker on|off`.

## What syncs

| Synced | Stays on each machine |
|---|---|
| `raw/` (sessions and backlog items) | `db/index.db` (each machine rebuilds it) |
| `tree/` (folders, `KNOWLEDGE.md`) | `config.json` (language, machine name, path map) |
| `digests/` | `daemon.pid`, `daemon.log` |
| `excluded.txt` (deleted sessions) | |

Each session records the machine it was captured on (`host`). The agent's own transcript only exists on that machine, so pressing `r` elsewhere offers a [handoff](./handoff.md) instead of a resume.

If your project paths differ between machines, map them so a handoff opens in the right directory:

```sh
mycelium sync map /Users/you/code /home/you/code
```

## When two machines change the same thing

| Change | Result |
|---|---|
| Different fields of one session (one moves it, the other tags it) | Both kept |
| The same session's folder | A person's placement beats an automatic one; between two people's, the later one |
| The same session's transcript | The longer one |
| The same session's summary | The one covering more of the transcript; a title you typed is always kept |
| One deletes a session, the other edits it | Deleted |
| The same folder's `KNOWLEDGE.md` | One version stays; the other becomes a pending proposal you review with `k` |

## Privacy

Session transcripts can contain anything you pasted into an agent, including secrets. Keep the central repo private: your own server or NAS, or a private repo you control.
