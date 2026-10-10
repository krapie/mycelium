**[← Back to README](../README.md)**

# Sync Across Machines

Mycelium keeps its store on one machine by default. Sync lets a laptop and an always-on home server, for example, share sessions: what the laptop captures ends up on the server, a backlog written on one can be started on the other, and a session started on one can be continued on the other through a handoff.

Sync uses `git`, run by Mycelium itself. You set it up once per machine; after that the TUI and the daemon sync in the background. There is no Mycelium-run server: the central copy is a git repository you host (a home server, a NAS, or a private repo on a git host).

## Two ways to sync

| Mode | What the machine does | Use it for |
|---|---|---|
| **One-way** (default) | Sends its sessions to the central machine and takes nothing back. It keeps only what it captured itself. | A laptop whose sessions should be kept on the server, without the server's sessions mixing into it. |
| **Collect** (`--collect`) | The central machine: gathers every machine's sessions into one store. | The home server. |
| **Two-way** (`--two-way`) | Exchanges changes with the remote both ways, so every two-way machine ends up with everything. | Machines you want to continue each other's work on, and share folders, knowledge and edits between. |

One-way and two-way machines can use the same server at once.

## One-way: laptop → home server

This is the common case: the server is the archive, each laptop keeps its own sessions and sends them over. The server may already have its own store; its sessions, and every laptop's, end up in one place there.

### Before you start (both machines)

- `mycelium sync status` prints a line about sync (`sync is not set up …` before setup). If it prints the general command list instead, the installed version predates sync; install from source:
  ```sh
  git clone https://github.com/krapie/mycelium.git && cd mycelium && npm install && npm link
  ```
- `git --version` works. Node.js 22.16 or newer.
- On every machine that should summarize its own sessions (all one-way machines, and the server), `claude` or `codex` is installed and logged in.
- The laptop can reach the server over ssh **with a key and no password prompt**: `ssh you@homeserver true` should return without asking anything. Background sync never prompts. `git` must also be on the server's PATH for non-interactive ssh sessions; check with `ssh you@homeserver git --version`.

### 1. On the home server

Stop anything writing to the store while it's converted, and keep a backup:

```sh
mycelium daemon --stop                       # if you run a detached daemon; also close any open TUI
cp -a ~/.mycelium ~/.mycelium.backup-$(date +%F)
```

Create the central repo and make this machine the one that collects. The server's existing sessions, folders, knowledge and digests become the first commit:

```sh
mycelium sync host ~/mycelium.git
mycelium sync init ~/mycelium.git --collect --worker
mycelium sync status                         # collect: gathers every machine's sessions into this store
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

`you@homeserver:mycelium.git` is relative to your home directory on the server; `ssh://you@homeserver/~/mycelium.git` means the same. The laptop sends everything it has and nothing comes back. A one-way machine summarizes and organizes its own sessions itself, since nobody else will.

If your projects live under different paths on the two machines, tell the server how to translate the laptop's paths, so a handoff there opens in the right directory:

```sh
mycelium sync map /Users/you/code /home/you/code      # on the server
```

### 3. Check it

- On the laptop, `mycelium sync` prints `sent`. Within a couple of minutes the server's daemon collects it; `mycelium sync` there collects it immediately.
- On the server, `mycelium list` shows the laptop's sessions next to its own, each marked `@machine`.
- `mycelium list` on the laptop shows only its own.

The TUI and the daemon sync every 2 minutes (`MYCELIUM_SYNC_MS`). Run `mycelium sync` to send immediately, for example right before closing the laptop.

### Deleting on the laptop does not delete on the server

A session deleted on a one-way machine stays on the server: the server is the archive, so cleaning up a laptop must not erase the copy sent to keep. To make deletions follow instead, run `mycelium sync deletes propagate` on the server (`keep` is the default). Folders and edits follow the laptop either way; only deleted sessions are held back.

## Two-way

For machines that should all hold everything, set each one up with `--two-way`:

```sh
mycelium sync init you@homeserver:mycelium.git --two-way
```

The first sync merges the machine's store with what is already on the remote, and from then on every change goes both ways, including deletions. A two-way machine receives everything the collecting machine holds. Only one machine in a two-way group should run the LLM upkeep (`--worker`, or `mycelium sync worker on|off`); otherwise every machine pays for the same calls and writes competing results. The others capture and sync automatically; the manual keys (`a`, `o`, `w`, `k`, `d`) work everywhere.

Change a machine's mode later with `mycelium sync mode push|two-way|collect`. Switching a laptop that already received the server's sessions to one-way doesn't remove them: restore its pre-sync backup first (`mv ~/.mycelium ~/.mycelium.old && cp -a ~/.mycelium.backup-<date> ~/.mycelium`), then run `mycelium sync init` again.

## Keep the server running

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

## Undo

The backup taken before `sync init` is the way back: sync turns the store into a git repo and records each session's machine in it. To undo on one machine, stop the daemon and TUI and restore it:

```sh
mycelium daemon --stop
mv ~/.mycelium ~/.mycelium.synced && cp -a ~/.mycelium.backup-<date> ~/.mycelium
```

## What syncs

| Synced | Stays on each machine |
|---|---|
| `raw/` (sessions and backlog items) | `db/index.db` (each machine rebuilds it) |
| `tree/` (folders, `KNOWLEDGE.md`) | `config.json` (language, machine name, path map, sync settings) |
| `digests/` | `daemon.pid`, `daemon.log` |
| `excluded.txt` (deleted sessions) | |

Each session records the machine it was captured on (`host`). The agent's own transcript only exists on that machine, so pressing `r` elsewhere offers a [handoff](./handoff.md) instead of a resume.

## Telling the machines apart

Once the store holds sessions from more than one machine (on the collecting or a two-way machine), every row in the Sessions list and the Calendar's day list carries an `@machine` badge: dim for this machine, highlighted for the others. The detail panel names the machine too. Press `Shift+H` to show one machine's sessions only. On the command line, `mycelium list` prints the same `@machine` and `mycelium list --host <machine>` filters to one. A store that only ever saw one machine shows none of this, which is why a one-way machine never does.

## When two machines change the same thing

This applies to the collecting machine merging a one-way machine's sessions, and to two-way machines.

| Change | Result |
|---|---|
| Different fields of one session (one moves it, the other tags it) | Both kept |
| The same session's folder | A person's placement beats an automatic one; between two people's, the later one |
| The same session's transcript | The longer one |
| The same session's summary | The one covering more of the transcript; a title you typed is always kept |
| One deletes a session, the other edits it | Deleted on two-way machines; kept on the collecting machine (see above) |
| The same folder's `KNOWLEDGE.md` | One version stays; the other becomes a pending proposal you review with `k` |

## Privacy

Session transcripts can contain anything you pasted into an agent, including secrets. Keep the central repo private: your own server or NAS, or a private repo you control.
