**[← Back to README](../README.md)**

# Learn/Reuse Loop (what a finished session feeds into the next one)

Mycelium "getting smarter automatically" does **not** mean it edits skills like Claude Code's `/write` or `/proofread`. Mycelium never touches skill definitions at all. What it actually updates is the **per-folder context** layered on top of them (`KNOWLEDGE.md` → `AGENTS.md`), making sure the next session already knows the conventions, phrasing, and structure that got settled in past sessions, from the moment it starts.

## Example: drafting correspondence while handling a case

1. **Capture.** Open a session in the `case/foo` folder's working
   directory, draft with `/write`, polish with `/proofread`. The session
   is captured in real time, so there's nothing extra to do at this step.
2. Polish the draft by hand into a final version. **That final version,
   or a note of what changed, has to exist as text inside the session**
   for the next step to learn from it. Mycelium can't see manual work
   that happens outside the session, an email client for instance. Paste
   the final version into the session, or leave one line, "changed this
   because that," before wrapping up.
3. **Organize.** If this is the first session in that folder, file it
   with `m` into `case/foo` (later sessions from the same working
   directory get auto-assigned by rule).
4. **Learn**
   - `a`. Summarizes and tags the session. To have a cleanup rule show up as a `decision`, ask once before wrapping up: "summarize the documentation conventions we settled on this time." `a` structures that answer into `decisions`. Each press updates whichever of summary, tags, decisions, and todos the latest extraction actually returns, leaving the rest as they were; press it again whenever the session has moved forward. Only the title, once set (whether `a` generated it first or you wrote it with `e`), stays put; fix it with `e` if the auto-extracted one isn't right.
   - `w`. **Extracts the folder's (`case/foo`) knowledge**: compiles the
     summaries and decisions of every session in that folder, not just
     this case but past cases in the same folder too, into
     `KNOWLEDGE.md`.
5. **Reuse.** The next time you open a new session in the same folder (`n`/`h`), Mycelium automatically injects that folder's current `KNOWLEDGE.md` into the working directory's `AGENTS.md`. Claude Code, Codex, Kiro, and OpenCode already know this folder's settled conventions the moment the session starts. `/write` and `/proofread` are unchanged, but the background knowledge underneath them has changed, so the output differs.

## What's actually automatic

| Stage | While the TUI is open | While the TUI is closed |
|---|---|---|
| Capture (scan) | Automatic every 5 min (no folder assignment, new sessions start unfiled) | Manual, `mycelium scan`, or reopen the TUI |
| Organize: smart organize (`o`) | Auto-computed every 30 min, queued (not applied by default) | Manual `o` or `mycelium organize` |
| Learn: summarize/tag (`a`) | Runs automatically on newly-captured sessions | Manual `a` or `mycelium autotag` |
| Learn: folder knowledge (`w`) | **Not automatic** | Manual `w` or `mycelium knowledge <folder>` |
| Reuse: AGENTS.md injection | Always automatic for sessions launched with `n`/`h` | Same, independent of whether the TUI is running |

This upkeep runs **inside the TUI process itself**, not a separate background process, so it always runs the currently installed code every time you open the TUI, and stops the moment you close it. It used to auto-spawn a detached daemon process when the TUI started, but that process would keep running old code after an update until manually restarted. This replaced it. If you want upkeep to keep running without the TUI open, see [the CLI reference's background-only section](./cli.md#background-only-no-tui-optional).

**Capture never assigns a folder.** Newly-captured sessions always start unfiled (`New`, `[New]`), and **smart organize (`o`) is the only path** to a folder. Since it's an LLM guess and can misclassify, it follows the same principle as `w`/`i`: a human always previews before anything is written.

Every 30 minutes (tune with the `MYCELIUM_SMART_ORGANIZE_MS` env var, up to `MYCELIUM_SMART_ORGANIZE_LIMIT` sessions per cycle, default 100), sessions a human hasn't confirmed yet get summarized, classified, and queued with a suggestion. Next time you open the TUI, a "N organize suggestions pending, press o to review" notice appears; pressing `o` shows that queued batch directly in the multi-select review screen **without recomputing**. Check the ones you want and `Enter` to apply; the rest get marked reviewed and drop out of the queue, and won't reappear. `Esc` does the same. Want to review them later? Press `o` again to compute fresh. To skip review and apply automatically, set `autoApproveSmartOrganize` to `true` in `~/.mycelium/config.json` (default `false`).

**Pressing `o` directly with an empty queue** (or `mycelium organize`) reviews every session a human hasn't filed themselves, even if it already has a folder. **The review scope is always whatever you're currently looking at**: the whole store from `Root`, only unfiled sessions from `New`, or that folder plus subfolders from inside one (the CLI narrows the same way with `--folder <path>`, or covers the whole store if omitted). The candidate folders it compares against, though, are always store-wide; it may suggest moving a session to a completely different folder than the one it's currently in. It suggests moving to an existing, already organized folder (one with KNOWLEDGE.md or accumulated summaries) when the content fits better there, or a **new folder** when nothing fits but the session has a clear topic of its own (labeled "new" in the suggestion list). Either way, a human always decides: only what's checked in the preview actually moves. Caps out at 200 per run (`mycelium organize --limit N` to adjust) so one run never reclassifies the entire store at once. Sessions with no clear match aren't asked about again for 24 hours (tune with `MYCELIUM_SMART_ORGANIZE_COOLDOWN_MS`). This keeps the 30-minute auto cycle from burning LLM calls on the same unmatched session repeatedly; pressing `o` yourself ignores this cooldown and re-evaluates immediately.

**"Automatic" only applies to sessions launched with `n`/`h`.** A session you open by typing `claude`/`codex`/`kiro-cli`/`opencode` directly in a terminal, or via a script, never goes through Mycelium, so this injection never triggers. `AGENTS.md` is just a file on disk, so if it was ever injected once before, that snapshot keeps being read, but **it won't automatically pick up later `KNOWLEDGE.md` updates.** To push the latest knowledge into a session opened outside Mycelium, use the TUI's `i` key right before, or:
```sh
mycelium inject --dir <project path> --folder <folder>   # --folder is required
```
Capture (scan) and Learn (summarize/tag) always run regardless of how a session was opened. Only this "refresh AGENTS.md" step depends on the launch path.

`w` (extract folder knowledge) is the one point that stays deliberately manual: deciding what counts as "the settled convention for this folder" is safer left to a human looking at the sessions at that moment, rather than rewriting `KNOWLEDGE.md` automatically every time a session comes in. It's possible to fold `w` into the daemon's scan cycle too. Ask if you want that.

**The TUI's `w`/`i` always preview before writing.** The LLM-generated `KNOWLEDGE.md` content, or whatever's about to be injected into `AGENTS.md`, shows in a scrollable window first; `y`/`Enter` saves it, `n`/`Esc` cancels. Since anything that lands in `KNOWLEDGE.md` gets auto-injected into every future session in that folder, there's one deliberate human review point before it's written. (The CLI's `mycelium knowledge <folder>` is a non-interactive call with nobody to confirm, so it writes directly, as before.) The `AGENTS.md` injection that happens automatically when launching an agent with `n`/`h`, though, just reflects an already-saved `KNOWLEDGE.md`; no confirmation there, since that confirmation already happened at the `w` step that saved it.
