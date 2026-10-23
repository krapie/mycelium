---
description: Pin an answer from this conversation to Mycelium, verbatim
argument-hint: "[N | pick] [note]"
allowed-tools: Bash(mycelium clip:*)
---
Mycelium listed the recent answers in this conversation before your reply:

!`mycelium clip add --here --list`

The user's arguments: $ARGUMENTS

Pin by running `mycelium clip add --here --turn <turn or range> --note "<note>"` with the Bash tool. Use only turn numbers from the list above, never guessed ones. Leave out `--note` when there is no note, and quote the note safely.

- No arguments, or only a note: pin the newest answer.
- A number N first (e.g. `3 note`): pin the last N turns ending at the newest answer, using the range form the list's last line gives.
- `pick` first: show the list to the user as a short numbered list, ask which turn or range to pin, and run nothing until they answer.

Then tell the user in one line what was clipped: the id and the preview line. If a command failed, show its error as it is. Do nothing else.
