**[← Back to README](../README.md)**

# TUI (the cockpit)

Running `mycelium` with no arguments opens the terminal UI: **Folders |
Sessions | Detail**, three columns, drilled into k9s-style — start at
folders, `Enter` into sessions, `Enter` into detail, `Esc` to go back. The
focused column widens.

The status bar always shows a **Capture·s → Organize·m/t/o → Learn·a/w →
Reuse·n/h/r** lifecycle strip — a static reference for which key belongs to
which stage (it doesn't highlight the current stage in real time). Press
**`?`** anywhere for the full shortcut reference.

**Display language defaults to English.** You're asked to pick a language
the first time you launch Mycelium (and every time you run `mycelium demo`,
right before the persona picker) — English or 한국어. From an already-running
session, press **`l`** anywhere to switch (confirm, then Mycelium restarts
to apply it — the same effect as running `mycelium lang <en|ko>` and
relaunching, just without leaving the TUI first). The demo's own mock
session content (titles, summaries, transcripts, extracted knowledge) is
fully bilingual too, not just the surrounding menus/narrator text — picking
한국어 for `mycelium demo` seeds genuinely Korean session content, not an
English demo with a Korean interface wrapped around it. Finishing the whole
demo hands off into your real `~/.mycelium` data in that same language too,
so it feels seamless rather than switching back — but only on a full finish
(`Esc` to bail early exits without touching your real language setting).

## Folders panel

The top **`Root`** entry is the tree's fixed top level (can't be renamed,
moved, or deleted) and **shows every session in the store** — including
ones already filed into folders; it's a literal grand total, not "whatever
hasn't been filed yet." Right below it, in the same list as real folders,
sits a special **`New`** entry that shows **only sessions not yet assigned
to any folder** (same restrictions as `Root` — no rename/move/delete/
knowledge-extract, since it's a view over unfiled sessions, not a real
folder). User-created folders appear below `New`, at the same indent level.
A **`[New]`** badge appears next to the title/summary anywhere an unfiled
session shows up (including under `Root`) — it disappears once you move the
session with `m`. Searching with `/` scopes to everything under `Root`, to
only unfiled sessions under `New`, or to that folder (+ subfolders) inside a
real folder — the same rule as any other real folder.

| Key | Action |
|---|---|
| `a` | New (sub)folder |
| `e` / `m` / `x` | Rename / move·nest / delete |
| `w` | Extract folder knowledge (KNOWLEDGE.md) |
| `Enter` | View this folder's sessions |

**The `_archive` folder is hidden from the TUI by default** — it never
appears in the folder list, the `Root` view, or search results. Move any
session there with `m` (e.g. a session from a dead worktree you no longer
use) to tuck it away out of sight. Nothing is deleted; to look at it later:
```sh
mycelium list --folder _archive
mycelium search "query" --folder _archive
```
Once a session is moved to `_archive`, re-scanning won't bring it back out —
`scan()` always preserves an already-assigned folder.

## Sessions panel

| Key | Action |
|---|---|
| `a` | Generate a content-based summary/tags (LLM; select several with `Space` first to batch). **Unless you've set the title yourself with `e`**, the title is also re-written from the latest content every time — summary/tags/decisions/todos are always refreshed |
| `e` | Edit **just the title** in a small modal (touches only Mycelium's own store — the original claude/codex/kiro session log is never modified). Summary/tags/decisions/todos always stay as the AI generated them; this key doesn't touch them. A title set here gets **locked** and survives future `a` presses (clear it to empty to unlock, which lets the next `a` auto-generate one again) |
| `r` | **Resume** that exact session in its original agent, right here. In the detail screen, `Enter` instead of `r` lets you choose "open here" (and, for ordinary sessions, "copy command" for pasting into a new tab). **Merged/split sessions can't be resumed directly** (there's no real id an actual agent knows about), so `h` (handoff) is offered instead — pick an agent and it starts a new session. **Once you return to that newly-created real session, the merged/split session's content is folded into it and the merge/split session itself disappears** — from then on, only that real session remains, resumable with `r` like any ordinary session (which is also why "copy command" isn't offered on merge/split sessions in the first place — there's no real id to resume) |
| `o` | **Smart organize** — the only way sessions get assigned to a folder (capture never auto-files). Reviews **only what's currently in view** (the whole store from `Root`, only unfiled sessions from `New`, or that folder + subfolders from inside one). Summarizes the target sessions, then compares them against already-organized folders (store-wide) to suggest a good existing folder or a **new subfolder to create**. Suggestions arrive **all pre-checked**, so `Enter` alone applies everything — uncheck the wrong ones with `Space` (unchecking still marks them reviewed and drops them from the queue), or `Esc` to cancel the whole batch (also drops from the queue — press `o` again to recompute fresh). New folders are labeled "new" in the list |
| `h` | **Start a new session** on a different agent, handing off context |
| `n` | Launch a new agent session with this folder's context. Hands over this same terminal (`foreground()`, `stdio: 'inherit'`) and blocks the whole TUI until that session exits — only one at a time |
| `Shift+N` | Same agent/directory picker as `n`, but copies the equivalent `cd <dir> && <bin> ...` shell command to the clipboard instead of opening it here. Paste into as many separate terminal tabs as you want to run several sessions in parallel — there's no portable way for Mycelium itself to open a new tab across terminal emulators, so this is the escape hatch |
| `m` / `t` | Move folder / edit tags |
| `x` | Delete the session (from Mycelium's own store only — the original log stays put, and it's recorded so a future scan won't re-capture it) |
| `y` | Copy the session (title + summary + transcript) to the clipboard |
| `Shift+M` | **Merge** — select 2+ with `Space` first. Originals are never modified; a single new session is created stitching the conversations together (like a git merge). Originals are hidden from the list (content preserved) and can be undone any time with `mycelium unmerge <id>` |
| `Shift+S` | **Split** — the current session (from either the list or detail) gets LLM-suggested topic boundaries to review, then only the ranges you keep become new sessions. New pieces land in the same folder as the original; **the original is never deleted or hidden** (its content wasn't moved, just partially copied). `mycelium unsplit <id>` deletes the pieces and reverts |
| `Shift+O` | **Cycle sort order** — recent (default) → title A-Z → agent, cycling back to recent. Display-only within the current folder/search scope, not persisted. The header shows the current sort when it's not the default |
| `Space` | Multi-select |
| `/` | Full-text search |
| `v` | Switch to the **Calendar tab** — the Sessions screen becomes a monthly grid \| that day's session list \| detail, three panels (same k9s-style drill-down: `←`/`→` move the day cursor ±1 day and `↑`/`↓` ±1 week, both rolling into the adjacent month at the edges and refreshing the list/detail live, `Enter`/`→` into the right panel, `Esc`/`←` back). `PgUp`/`PgDn` jumps a whole month. Press `v` again (or `Esc` from the grid) to return to Sessions — folder selection, search terms, etc. are preserved |
| `s` | **Scan** right from the TUI (same as `mycelium scan` — pulls in sessions left open in other tabs/terminals without leaving the TUI). Doesn't assign folders — new sessions land unfiled (`New`, `[New]`), sort with `o` above |
| `w` / `c` / `i` / `d` | Extract folder knowledge (preview then confirm) / view context / inject AGENTS.md (preview then confirm) / read digests (`n`/`w` inside to generate today's/this week's) |
| `g` | **Re-show the getting-started guide** — the short walkthrough (4-stage lifecycle + key shortcuts) that auto-shows once on first launch, any time |
| `q` | Quit |

Sessions connected by handoff show `[Resumed]`/`[Handoff]` tags in the list
and "Continues:"/"Continued by:" links in detail. Merged/split sessions
show `[Merged]` (merge result) / `[Split]` (split result) tags; a split
original (or, for merges, the hidden originals) shows a `[Linked]` tag.
The detail screen shows which session something came from or went to as
clickable-style links.
