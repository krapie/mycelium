---
description: Note something to work on later in Mycelium's backlog for this project, or list what's waiting.
disable-model-invocation: true
argument-hint: "[what to do later]"
allowed-tools: Bash(mycelium backlog:*)
---

Request: $ARGUMENTS

- If the request is empty, run `mycelium backlog list --here` and show the waiting items briefly. Tell the user that `mycelium backlog open <id>` prints the command that starts one.
- Otherwise, turn the request into a short title, and optionally a one- or two-sentence `--desc` drawn from the current conversation's context. Run `mycelium backlog add "<title>" --desc "<desc>" --here`, then confirm in one line. `--here` files the item under this directory's Mycelium folder.

Don't start working on the item.
