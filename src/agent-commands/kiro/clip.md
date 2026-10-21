Pin an answer from this conversation to Mycelium, verbatim. What I wrote after the prompt name are the arguments: `[N | pick] [note]`.

1. First run this shell command, which lists the recent answers before this message with their turn numbers:

   mycelium clip add --here --list --skip-request

2. Pin by running `mycelium clip add --here --turn <turn or range> --note "<note>"`. Use only turn numbers from that list, never guessed ones. Leave out `--note` when there is no note, and quote the note safely.

   - No arguments, or only a note: pin the newest answer.
   - A number N first (e.g. `3 note`): pin the last N turns ending at the newest answer, using the range form the list's last line gives.
   - `pick` first: show me the list as a short numbered list, ask which turn or range to pin, and run nothing until I answer.

3. Tell me in one line what was clipped: the id and the preview line. If a command failed, show its error as it is and do not retry with a session id you guessed. Do nothing else.
