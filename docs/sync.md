**[← Back to README](../README.md)**

# Sync Across Machines

Mycelium keeps its store on one machine by default. Sync lets several machines, for example a laptop and an always-on home server, share one store: sessions captured on either show up on both, a backlog written on one can be started on the other, and a session started on one can be continued on the other through a handoff.

Sync uses `git`, run by Mycelium itself. You set it up once per machine; after that the TUI and the daemon keep it in sync in the background. There is no Mycelium-run server: the central copy is a git repository you host (a home server, a NAS, or a private repo on a git host).

## Setup: a laptop and a home server

This walks through the common case: a home server that is always on and already has its own Mycelium store, plus a laptop with a separate store. The server holds the central repo and runs the LLM upkeep; the laptop syncs with it. Each machine's existing sessions are kept and merged into one store.

### Before you start (both machines)

- `mycelium sync status` prints a line about sync (`sync is not set up …` before setup). If it prints the general command list instead, the installed version predates sync; install from source:
  ```sh
  git clone https://github.com/krapie/mycelium.git && cd mycelium && npm install && npm link
  ```
- `git --version` works. Node.js 22.16 or newer.
- On the server, `claude` or `codex` is installed and logged in. The server runs all automatic summarizing, so its subscription is the one used.
- The laptop can reach the server over ssh **with a key and no password prompt**: `ssh you@homeserver true` should return without asking anything. Background sync never prompts. `git` must also be on the server's PATH for non-interactive ssh sessions; check with `ssh you@homeserver git --version`.

### 1. On the home server

Stop anything writing to the store while it's converted, and keep a backup:

```sh
mycelium daemon --stop                       # if you run a detached daemon; also close any open TUI
cp -a ~/.mycelium ~/.mycelium.backup-$(date +%F)
```

Create the central repo and connect the server's own store to it. The server's existing sessions, folders, knowledge and digests become the first commit:

```sh
mycelium sync host ~/mycelium.git
mycelium sync init ~/mycelium.git --worker
mycelium sync status                         # remote: /home/you/mycelium.git, LLM upkeep on, unsynced: 0 file(s)
```

Keep upkeep and sync running in the background (see [Keep the server running](#keep-the-server-running) to survive reboots):

```sh
mycelium daemon --detach
```

### 2. On the laptop

```sh
cp -a ~/.mycelium ~/.mycelium.backup-$(date +%F)
mycelium sync init you@homeserver:mycelium.git
```

`you@homeserver:mycelium.git` is relative to your home directory on the server; `ssh://you@homeserver/~/mycelium.git` means the same. The first sync merges the laptop's store with the server's: afterwards `mycelium list` on the laptop shows sessions from both machines.

If your projects live under different paths on the two machines, tell each machine how to translate the other's paths, so a handoff opens in the right directory:

```sh
mycelium sync map /home/you/code /Users/you/code      # on the laptop
```
```sh
mycelium sync map /Users/you/code /home/you/code      # on the server
```

### 3. Check it

- On the server, run `mycelium sync` (or wait up to 2 minutes for the daemon). `mycelium list` now shows the laptop's sessions too.
- `git -C ~/.mycelium log --oneline` on either machine shows one `sync: <machine>` commit per machine plus the merge.

From here on, the TUI and the daemon sync every 2 minutes (`MYCELIUM_SYNC_MS`). Run `mycelium sync` to sync immediately, for example right before closing the laptop.

### Keep the server running

`mycelium daemon --detach` stops when the server reboots. On Linux, run it as a systemd user service instead:

```ini
# ~/.config/systemd/user/mycelium.service
[Unit]
Description=Mycelium upkeep and sync

[Service]
ExecStart=/usr/bin/env mycelium daemon
Restart=on-failure
# systemd starts with a minimal PATH: include where node, mycelium, git and claude/codex live (`dirname $(which mycelium)` etc.)
Environment=PATH=/home/you/.local/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
```

```sh
mycelium daemon --stop                          # if the detached one is running
systemctl --user daemon-reload
systemctl --user enable --now mycelium
loginctl enable-linger "$USER"                  # keep running without an open login session
journalctl --user -u mycelium -f                # logs
```

After updating Mycelium, restart it (`systemctl --user restart mycelium`, or `--stop` then `--detach`): a running daemon keeps the code it started with.

### Undo

The backup taken before `sync init` is the way back: sync turns the store into a git repo and records each session's machine in it. To undo on one machine, stop the daemon and TUI and restore it:

```sh
mycelium daemon --stop
mv ~/.mycelium ~/.mycelium.synced && cp -a ~/.mycelium.backup-<date> ~/.mycelium
```

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

## Telling the machines apart

Once the store holds sessions from more than one machine, every row in the Sessions list and the Calendar's day list carries an `@machine` badge: dim for this machine, highlighted for the others. The detail panel names the machine too. Press `Shift+H` to show one machine's sessions only. On the command line, `mycelium list` prints the same `@machine` and `mycelium list --host <machine>` filters to one. A store that only ever saw one machine shows none of this.

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
