---
name: clip
description: Pin an answer from this conversation to Mycelium, verbatim. Use only when the user explicitly invokes $clip or asks to clip or pin an answer to Mycelium.
---

# Clip to Mycelium

The user's message that invoked this skill is the request. What they wrote with `$clip` are the arguments: `[N | pick] [note]`.

1. First run this shell command, which lists the recent answers before the request with their turn numbers:

   mycelium clip add --here --list --skip-request

2. Pin by running `mycelium clip add --here --turn <turn or range> --note "<note>"`. Use only turn numbers from that list, never guessed ones. Leave out `--note` when there is no note, and quote the note safely.

   - No arguments, or only a note: pin the newest answer.
   - A number N first (e.g. `3 note`): pin the last N turns ending at the newest answer, using the range form the list's last line gives.
   - `pick` first: show the user the list as a short numbered list, ask which turn or range to pin, and run nothing until they answer.

3. Tell the user in one line what was clipped: the id and the preview line.

If a command fails, show its error as it is. Do not retry with a session id you guessed. Do nothing else.
