**[← Back to README](../README.md)**

# TUI (the cockpit)

Running `mycelium` with no arguments opens the terminal UI: **Folders | Sessions | Detail**, three columns, drilled into k9s style. Start at folders, `Enter` into sessions, `Enter` into detail, `Esc` to go back. The focused column widens.

The status bar always shows the short **Context Flywheel** loop, `Capture·s → Organize·o → Learn·w → Reuse·n`, the same four canonical stages as the rest of this doc, each paired with its one flywheel key. It is not the full stage by stage breakdown; there is no room for that on a one line status bar seen on every screen. Press **`?`** anywhere for the full shortcut reference, which leads with the same loop before the complete key by key breakdown of every stage.

**Display language defaults to English.** You pick a language the first time you launch Mycelium, and again every time you run `mycelium demo` right before the persona picker: English or 한국어. From an already running session, press **`l`** anywhere to switch (confirm, then Mycelium restarts to apply it, the same effect as running `mycelium lang <en|ko>` and relaunching). The demo's mock session content (titles, summaries, transcripts, extracted knowledge) is fully bilingual too, not just the menus and narrator text. Picking 한국어 for `mycelium demo` seeds genuinely Korean session content, not an English demo wrapped in a Korean interface. Finishing the whole demo hands off into your real `~/.mycelium` data in that same language, so it feels seamless rather than switching back (`Esc` to bail early exits without touching your real language setting).

## Folders panel

The top **`Root`** entry is the tree's fixed top level (cannot be renamed, moved, or deleted) and **shows every non-archived session in the store**, including ones already filed into folders. It is a literal grand total, not only whatever has not been filed yet; the one exception is `_archive`, hidden from `Root` the same way it's hidden everywhere else (see below). Right below it, in the same list as real folders, sits a special **`New`** entry that shows **only sessions not yet assigned to any folder** (same restrictions as `Root`: no rename, move, delete, or knowledge extract, since it is a view over unfiled sessions, not a real folder). User-created folders appear below `New`, at the same indent level. A **`[New]`** badge appears next to the title or summary anywhere an unfiled session shows up, including under `Root`, and disappears once you move the session with `m`. Searching with `/` scopes to everything under `Root`, to only unfiled sessions under `New`, or to that folder plus subfolders inside a real folder, the same rule as any other real folder.

| Key | Action |
|---|---|
| `a` | New (sub)folder |
| `e` / `m` / `x` | Rename / move and nest / delete |
| `w` | Extract folder knowledge (KNOWLEDGE.md) |
| `Enter` | View this folder's sessions |

**The `_archive` folder is hidden from the TUI by default.** It never appears in the folder list, the `Root` view, or search results. Move any session there with `m`, for example a session from a dead worktree you no longer use, to tuck it away out of sight. Nothing is deleted; to look at it later:
```sh
mycelium list --folder _archive
mycelium search "query" --folder _archive
```
Once a session is moved to `_archive`, re-scanning will not bring it back out. `scan()` always preserves an already assigned folder.

## Sessions panel

| Key | Action |
|---|---|
| `a` | Generate a content based summary and tags (LLM; select several with `Space` first to batch). Unless you have set the title yourself with `e`, the title is also rewritten from the latest content every time. Summary, tags, decisions, and todos are always refreshed |
| `e` | Edit **just the title** in a small modal (touches only Mycelium's own store, never the original claude/codex/kiro session log). Summary, tags, decisions, and todos always stay as the AI generated them; this key does not touch them. A title set here gets **locked** and survives future `a` presses (clear it to empty to unlock, letting the next `a` auto generate one again) |
| `r` | **Resume** that exact session in its original agent, right here. In the detail screen, `Enter` instead of `r` offers "open here" (and, for ordinary sessions, "copy command" for pasting into a new tab). **Merged or split sessions cannot be resumed directly** since there is no real id an agent knows about, so `h` (handoff) is offered instead: pick an agent and it starts a new session. Once you return to that newly created real session, the merged or split session's content folds into it and the merge or split session disappears. From then on only that real session remains, resumable with `r` like any ordinary session |
| `o` | **Smart organize**, the only way sessions get assigned to a folder (capture never auto files). Reviews only what is currently in view: the whole store from `Root`, only unfiled sessions from `New`, or that folder plus subfolders from inside one. Summarizes the target sessions, then compares them against already organized folders store wide to suggest a good existing folder or a **new subfolder to create**. Suggestions arrive **all pre checked**, so `Enter` alone applies everything. Uncheck the wrong ones with `Space` (still marks them reviewed and drops them from the queue), or `Esc` to cancel the whole batch (also drops from the queue, press `o` again to recompute fresh). New folders are labeled "new" in the list |
| `h` | **Start a new session** on a different agent, handing off context |
| `n` | Launch a new agent session with this folder's context. After picking an agent and directory, asks **"open here"** (hands over this same terminal and blocks the whole TUI until that session exits, only one at a time) or **"copy command"** (copies the equivalent `cd <dir> && <bin> ...` shell command to the clipboard, to paste into a separate terminal tab and run several sessions in parallel; there is no portable way for Mycelium to open a new tab across terminal emulators). Same choice `Enter` already offers when resuming an existing session |
| `b` | **Add a backlog item**, something to work on later, written before any agent has run: a title, then optional notes for the agent, filed into the folder you are browsing (unfiled if you are on `Root`). It sits in the list like any session with a `[Backlog]` badge instead of an agent name. Press `r` on it (or `Enter` from detail) whenever you are ready and an agent starts seeded with those notes plus the folder's knowledge; the session that comes back is linked as its continuation and takes its place in the list. That holds for "copy command" too — the seed carries a marker that links whatever session the pasted command starts, whenever it is captured. `e` edits both the title and the notes, since both are your own text. Also available as `mycelium backlog add` / `open` |
| `m` / `t` | Move folder / edit tags |
| `x` | Delete the session, from Mycelium's own store only. The original log stays put and is recorded so a future scan will not re capture it |
| `y` | Copy the session (title, summary, transcript) to the clipboard. For an arbitrary snippet instead of the whole session, `Shift`+drag to select (`Option`+drag on iTerm2), then `Cmd+C` / `Ctrl+Shift+C`, since mouse tracking normally swallows drags and `Shift` bypasses it |
| `Shift+M` | **Merge**, select 2+ with `Space` first. Originals are never modified; a single new session is created stitching the conversations together, like a git merge. Originals are hidden from the list with content preserved, and can be undone any time with `mycelium unmerge <id>` |
| `Shift+S` | **Split**, the current session (from either the list or detail) gets LLM suggested topic boundaries to review, then only the ranges you keep become new sessions. New pieces land in the same folder as the original; **the original is never deleted or hidden**, its content was not moved, just partially copied. `mycelium unsplit <id>` deletes the pieces and reverts |
| `Shift+O` | **Cycle sort order**: recent (default), title A to Z, agent, then back to recent. Display only within the current folder or search scope, not persisted. The header shows the current sort when it is not the default |
| `Shift+T` | **Pick a sort order directly**, a menu with all 4 orderable options (newest first, oldest first, title A→Z, title Z→A), instead of cycling blind through `Shift+O`. Both write the same underlying sort state, so they never disagree; `Shift+O` still works exactly as before and remains the only way to sort by agent |
| `Space` | Multi-select |
| `/` | Full text search |
| `v` | Switch to the **Calendar tab**: the Sessions screen becomes a monthly grid, that day's session list, and detail, three panels with the same k9s style drill down (`←`/`→` move the day cursor by 1 day, `↑`/`↓` by 1 week, both rolling into the adjacent month at the edges and refreshing the list and detail live; `Enter`/`→` into the right panel, `Esc`/`←` back). `PgUp`/`PgDn` jumps a whole month. Press `v` again, or `Esc` from the grid, to return to Sessions; folder selection and search terms are preserved |
| `s` | **Scan** right from the TUI, same as `mycelium scan`. Pulls in sessions left open in other tabs or terminals without leaving the TUI. Does not assign folders; new sessions land unfiled (`New`, `[New]`), sort with `o` above |
| `w` / `c` / `i` / `d` | Extract folder knowledge (preview then confirm) / view context / inject AGENTS.md, also drops a one line CLAUDE.md bridge so Claude Code actually reads it (preview then confirm) / read digests (`n`/`w` inside to generate today's or this week's narrative summary) |
| `k` | **Knowledge review**, see below. Unrelated to Digest (`d`) |
| `g` | **Re-show the getting started guide**, the short walkthrough (4 stage lifecycle plus key shortcuts) that auto shows once on first launch, any time |
| `q` | Quit |

Sessions connected by handoff show `[Resumed]`/`[Handoff]` tags in the list and "Continues:"/"Continued by:" links in detail. Merged or split sessions show `[Merged]` (merge result) and `[Split]` (split result) tags; a split original, or a merge's hidden originals, shows a `[Linked]` tag. The detail screen shows which session something came from or went to as clickable style links.

## Knowledge review

Keeping every active folder's KNOWLEDGE.md fresh by hand (`w`, folder by folder) is easy to fall behind on. `k` does it for up to `MYCELIUM_DIGEST_KNOWLEDGE_LIMIT` folders at once (default 10; a folder beyond that cap on an unusually busy day isn't automatically retried later), unrelated to Digest (`d`, a separate narrative summary feature that just happens to share the day-based idea). Pressing `k` mirrors `o` (smart organize) exactly: if the daemon already computed a proposal overnight, it opens instantly; if not, Mycelium computes one on the spot for whatever is active today, then opens the same review.

**`k` is the expected, primary way to do this**, normally at the end of your day. If you do not get to it, the daemon quietly catches up on yesterday's activity the next time it runs, so nothing is lost either way. The result is the same whether a human or Mycelium triggered it, since both paths call the same underlying function.

The review itself is the same checkbox list `o` uses: every folder starts checked, `Space` to uncheck one you do not want, `Enter` applies the checked ones. The list only shows a short one line snippet per folder; press `p` on the highlighted row to open the **full** proposed KNOWLEDGE.md text before deciding, then `p`/`Esc`/`q` again to return to the checklist. **Approving a folder writes its KNOWLEDGE.md**, that is the content decision. Whatever is left unchecked, or the whole batch on `Esc`, is simply dismissed. It will not keep asking again, and a manual `w` can always regenerate it later.

**Which directories actually get the injection is a separate question.** A folder groups sessions by *topic*, and a topic is not always one project. A quick question asked from an unrelated repo's terminal still gets content classified into the real project's folder alongside genuine project sessions, so the folder can end up spanning directories that have nothing to do with each other. If an approved folder's sessions only ever ran in one directory, `k` injects straight through, no extra prompt, the same trust level `n`/`h`'s own silent auto-inject on launch already operates at. If they ran in **more than one**, a second checklist opens (all pre checked) so you can uncheck whichever directory does not actually belong before anything gets written. If a proposal is still unreviewed the next time you open Mycelium, a toast points you at `k`.
