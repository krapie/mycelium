---
description: Show or change which Mycelium folder this directory belongs to (it decides which knowledge new sessions here start with).
disable-model-invocation: true
argument-hint: "[folder path | --unset]"
allowed-tools: Bash(mycelium link:*)
---

Run `mycelium link $ARGUMENTS` and report the result in one line.

With no argument, it shows the current folder and whether it was linked by hand or inferred from earlier sessions. With a folder path such as `company/platform/auth`, it pins this directory to that folder. With `--unset`, it removes the pin. The change takes effect from the next session.
