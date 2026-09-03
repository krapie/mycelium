import { loadConfig, saveConfig } from '../config.js';

// TUI display language. Read once at process start (the TUI is a fresh
// process per launch — no in-session toggle key, only `mycelium lang <en|ko>`
// beforehand). Defaults to English; `en` is also the fallback for any key
// missing from a non-English dictionary, so partial translations never crash.
let locale = loadConfig().locale || 'en';

export function getLocale() {
  return locale;
}

export function setLocale(l) {
  locale = l;
  const cfg = loadConfig();
  cfg.locale = l;
  saveConfig(cfg);
}

const en = {
  'app.needsTty': 'Run the Mycelium TUI in a real terminal (TTY).',
  'app.confirmQuitTitle': 'Quit?',
  'app.confirmQuitHint': (fg) => `Press {${fg}-fg}q{/} again to confirm, or any other key to cancel.`,
  'app.confirmLanguageTitle': 'Switch language?',
  'app.confirmLanguageHint': (fg, label) =>
    `Press {${fg}-fg}l{/} again to switch to ${label} (Mycelium will restart), or any other key to cancel.`,
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.none': '(none)',
  'common.noContent': '(no content)',
  'common.searchPrompt': 'Search',
  'folders.root': 'Root',
  'folders.new': 'New',
  'sessions.foldersPanelLabel': ' Folders ',
  'sessions.sessionsPanelLabel': ' Sessions ',
  'sessions.detailPanelLabel': ' Detail ',
  'sessions.newBadge': 'New',
  'sessions.mergedBadge': 'Merged',
  'sessions.splitBadge': 'Split',
  'sessions.linkedBadge': 'Linked',
  'sessions.resumedBadge': 'Resumed',
  'sessions.handoffBadge': 'Handoff',
  'sessions.backlogBadge': 'Backlog',
  'sessions.backlogOpenedBadge': 'Opened',

  // sessions.js — folders panel
  'folders.newPrompt': (parent) => `New folder name${parent ? ` (under ${parent})` : ' (root)'}`,
  'folders.created': (path) => `Folder created: ${path}`,
  'folders.cannotRenameRoot': "Root can't be renamed",
  'folders.renamePrompt': (f) => `Rename: ${f}`,
  'folders.renamed': (to) => `Renamed: ${to}`,
  'folders.cannotMoveRoot': "Root can't be moved",
  'folders.movedTo': (to) => `Moved: ${to}`,
  'folders.cannotDeleteRoot': "Root can't be deleted",
  'folders.deleteConfirmTitle': (f) => `Delete "${f}"?`,
  'folders.deleteConfirmYes': (newLabel) => `Delete (sessions become unfiled, shown under ${newLabel})`,
  'folders.deleted': (moved) => `Deleted (${moved} session(s) → unfiled)`,
  'folders.selectFirst': 'Select a folder first',

  // sessions.js — session list / detail
  'sessions.empty': 'No sessions',
  'sessions.movedTo': (n, folder) => `${n} session(s) → ${folder}`,
  'sessions.tagsUpdated': (n) => `${n} session(s) tags updated`,
  'sessions.deleteConfirmTitle': (n) => `Delete ${n} session(s)? (Mycelium record only, original log kept)`,
  'sessions.deleted': (n) => `${n} session(s) deleted`,
  'sessions.summarizing': (i, n) => `Summarizing… (${i}/${n})`,
  // Static prefix (no counts) — app.js's startProgressBar() appends
  // "(current/total)" itself, unlike the plain-spinner counted version
  // above (still used by other startSpinner() call sites, e.g. tag-all).
  'sessions.summarizingLabel': 'Summarizing…',
  'sessions.summarizeDone': (done, failed, lastError) =>
    `Summarized: ${done}${failed ? ` (failed ${failed}${lastError ? `: ${lastError}` : ''})` : ''}`,
  'sessions.copied': 'Session content copied to clipboard',
  'sessions.copyFailed': 'No clipboard tool found (pbcopy etc.)',
  'sessions.sortLabel_title': 'sort: title A-Z',
  'sessions.sortLabel_agent': 'sort: agent',
  'sessions.sortLabel_title-desc': 'sort: title Z-A',
  'sessions.sortLabel_date-asc': 'sort: oldest first',
  'sessions.sortLabel_date-desc': 'sort: newest first',
  'sessions.sortPickerTitle': 'Sort by',
  'sessions.sortOption_recent': 'Newest first',
  'sessions.sortOption_dateAsc': 'Oldest first',
  'sessions.sortOption_title': 'Title A → Z',
  'sessions.sortOption_titleDesc': 'Title Z → A',
  'sessions.unfiledHint': (n) => `${n} session(s) captured, no folders yet — press o to sort them by content`,
  // Large-backlog counterpart to unfiledHint above — index.js promotes to
  // this modal instead of the toast once the unfiled count clears
  // FIRST_SCAN_MODAL_THRESHOLD, since a real first scan can mean minutes
  // of classification, not an instant.
  'sessions.firstScanModalLabel': ' First scan done — nothing organized yet (Enter/Esc to dismiss) ',
  'sessions.firstScanBody': (n, fg) =>
    `{bold}${n} sessions captured, nothing organized yet.{/} Press {${fg}-fg}o{/} to sort them all by content — Mycelium reads and classifies each one, which takes real time for a backlog this size. Feel free to switch away and do something else in the meantime — it keeps running; come back and review the suggestions whenever you're ready.\n\n` +
    `Tip: don't need all of these? Press {${fg}-fg}Space{/} to select sessions, then {${fg}-fg}x{/} to delete them — fewer sessions means fewer LLM calls when you press o.`,
  'detail.noSummary': '(no summary yet — press a in the session to summarize/tag)',
  'detail.lastActive': 'last active',
  'detail.firstRequest': 'First request:',
  'detail.id': 'ID:',
  'detail.summary': 'Summary',
  'detail.decisions': 'Decisions',
  'detail.todos': 'Action Items',
  'detail.continuationOf': (label) => `Continues: ${label}`,
  'detail.continuedTo': (label) => `Continued by: ${label}`,
  'detail.fromBacklog': (label) => `Started from backlog: ${label}`,
  'detail.backlogStarted': (label) => `Started as: ${label}`,
  'detail.mergedFrom': (n, labels) => `Merged from ${n}: ${labels}`,
  'detail.splitFrom': (label) => `Split from: ${label}`,
  'detail.superseded': (labels) => `Superseded by: ${labels}`,
  'detail.splitInto': (n, labels) => `Split into ${n}: ${labels}`,

  // sessions.js — status bar. Used to spell out the full 4-stage/11-key
  // breakdown on every screen; that detail now lives in the `?` modal
  // instead, and this just names the loop's four canonical stages
  // (matching README.md/AGENTS.md) with their one flywheel key each.
  'lifecycle.bar': (fg) =>
    `Capture·{${fg}-fg}s{/} → Organize·{${fg}-fg}o{/} → Learn·{${fg}-fg}w{/} → Reuse·{${fg}-fg}n{/}`,
  'status.helpFallback': '. menu   ? all shortcuts   q quit',

  // sessions.js — scan
  'scan.inProgress': 'Scanning…',
  'scan.failed': (msg) => `Scan failed: ${msg}`,
  'scan.done': (imported, scanned, skipped, failed) =>
    `Scan +${imported} (of ${scanned}, skipped ${skipped}${failed ? `, failed ${failed}` : ''})`,

  // sessions.js — knowledge / context / inject
  'knowledge.generating': 'Drafting knowledge…',
  'knowledge.previewTitle': (folder) => `KNOWLEDGE.md preview · ${folder}`,
  'knowledge.cancelled': 'Cancelled — KNOWLEDGE.md unchanged',
  'knowledge.saved': (folder) => `KNOWLEDGE.md saved: ${folder}`,
  'knowledge.reviewRunning': 'Checking today\'s active folders for a knowledge refresh…',
  'knowledge.reviewNone': 'No knowledge updates to review right now',
  'knowledge.reviewTitle': 'Review knowledge updates',
  'knowledge.injectDirsTitle': 'Inject into which directories?',
  'knowledge.reviewApplied': (n) => `Updated KNOWLEDGE.md and injected AGENTS.md for ${n} folder(s)`,
  'knowledge.reviewSkipped': 'No changes applied',
  'knowledge.pendingOnOpen': (n) => `${n} folder(s) have knowledge ready to review — press k`,
  'context.title': (folder) => `Context · ${folder}`,
  'context.empty': '(no inherited context)',
  'context.needsFolder': 'Only works on a session that has a folder',
  'inject.dirPrompt': 'Directory to inject AGENTS.md into',
  'inject.noKnowledge': (folder) => `No KNOWLEDGE.md to inject: ${folder}`,
  'inject.previewTitle': (dir) => `Content to inject into ${dir}/AGENTS.md`,
  'inject.cancelled': 'Cancelled — AGENTS.md unchanged',
  'inject.done': (dir) => `AGENTS.md injected: ${dir}`,

  // sessions.js — clipboard export (sessionToText)
  'export.summary': '## Summary',
  'export.decisions': '## Decisions',
  'export.todos': '## To-dos',
  'export.files': '## Files',
  'export.conversation': '## Conversation',

  // viewers.js
  'viewer.textViewLabel': (title) => ` ${title} (↑↓ scroll, y copy, Esc close) `,
  'viewer.copiedLabel': (title) => ` ${title} (copied) `,
  'viewer.copyFailedLabel': (title) => ` ${title} (copy failed) `,
  'viewer.confirmLabel': (title) => ` ${title} (↑↓ scroll, y/Enter save, n/Esc cancel) `,
  'digest.label': ' Digest (Enter open, n generate today, w generate this week, Esc close) ',
  'digest.empty': '{gray-fg}(none — n/w to generate){/}',
  'digest.generating': ' Generating digest… ',
  'digest.generated': (keyed) => ` Generated: ${keyed} `,
  'digest.failed': (err) => ` Failed: ${err} `,
  'digest.readFailed': '(read failed)',
  'help.modalLabel': ' Keymap help (↑↓ scroll, Esc/? close) ',
  'welcome.modalLabel': ' Welcome to Mycelium (Enter/Esc to start) ',
  'welcome.body': null, // filled in below, function like help.text

  // cli.js's `mycelium demo` handoff — printed with a plain console.log(),
  // not inside a blessed screen (the child tutorial process has already
  // torn its own screen down by this point, restoring the terminal to a
  // normal printable state), right before the real TUI's own cold import/
  // mount work happens. Without this, a slower machine could show a
  // silent, blank-looking gap between the tutorial ending and the real
  // session appearing — long enough to wonder if anything happened.
  'demo.handoffTransition': 'Wrapping up — switching to your real data…',

  // First-run tutorial (tutorial.js) — mock sessions, real o/w LLM calls.
  // Body strings are (fg) => `...` functions (same style as help.text/
  // welcome.body) so the key they're waiting for can be highlighted inline.
  'tutorial.promptTitle': 'First time here! Want a quick interactive tour?',
  'tutorial.promptYes': 'Start the tutorial',
  'tutorial.promptNo': 'Skip, just show me around',
  'tutorial.personaPromptTitle': 'Whose work should the tour follow?',
  'tutorial.exitHint': 'q: exit tutorial',
  // Shown instead of exitHint above, only on the tutorial's last step — q
  // there completes the tour and hands off into real data, not a plain
  // exit, so it gets its own accurate wording (tutorial.js's render()).
  'tutorial.finishHint': 'q: finish & switch to your real data',
  // "Step N/Total" itself — see tutorial.js's render(), computed from
  // STEPS.length/index rather than baked into each stepNTitle below, so
  // every stepNTitle now holds only its subtitle (or '' for steps without
  // one) and inserting/removing a step never means renumbering anything.
  'tutorial.stepCounter': (n, total) => `Step ${n}/${total}`,
  'tutorial.introTitle': '',
  'tutorial.introBody': (fg) =>
    `{bold}Welcome to Mycelium{/}: organize your AI sessions, and carry what they know into the next one, through {${fg}-fg}Capture → Organize → Learn → Reuse{/}. Every session from Claude Code, Codex, Kiro, or OpenCode gets captured automatically; this tour shows you the loop that keeps them useful instead of lost.\n\n` +
    `Three panels (Folders → Sessions → Detail) walked with {${fg}-fg}→{/}/{${fg}-fg}←{/}. Press {${fg}-fg}Enter{/} now to step into your first folder and begin.`,
  'tutorial.stepPaletteTitle': ' — Menu',
  'tutorial.stepPaletteBody': (fg) =>
    `No need to memorize shortcuts: press {${fg}-fg}.{/} from the Folders or Sessions panel and you'll get a menu of what you can actually do from there. Each item shows its key, grouped as SESSION (acts on the session) and FOLDER (acts on the folder).`,
  'tutorial.stepPaletteAckTitle': '',
  'tutorial.stepPaletteAckBody': (fg) =>
    `That's it. Press {${fg}-fg}Esc{/} to close.\n\n` +
    `From here on, whenever a step's action also appears in this menu (Organize, Knowledge, Scan, Merge, Split), you can either press its key directly or open the menu with {${fg}-fg}.{/} and pick it; both do exactly the same thing.`,
  'tutorial.stepScanTitle': ' — Capture',
  'tutorial.stepScanBody': (fg) =>
    `Nothing has been captured yet. Press {${fg}-fg}s{/} (or {${fg}-fg}.{/} → Scan) to pull your AI sessions in; that's Capture, step one of the loop, the exact same action that runs quietly in the background for Claude Code, Codex, Kiro, and OpenCode.`,
  'tutorial.step2Title': ' — Organize',
  'tutorial.step2Body': (fg, count) => `${count} fresh, unfiled sessions are sitting below. Press {${fg}-fg}o{/} (or {${fg}-fg}.{/} → Organize) to have Mycelium read them and suggest folders.`,
  'tutorial.step3Title': '',
  'tutorial.step3Body': (fg) => `Review the suggested folders, then press {${fg}-fg}Enter{/} to apply them.`,
  'tutorial.step4Title': '',
  'tutorial.step4Body': (fg, count, folder) =>
    `Folders were created automatically and your sessions are sorted. Several landed together in \`${folder}\`. Press {${fg}-fg}←{/} to get back to the Folders panel, then {${fg}-fg}↓{/} to find it and {${fg}-fg}Enter{/}/→ to open it.`,
  'tutorial.step5Title': ' — Learn',
  'tutorial.step5Body': (fg, count, folder) => `With \`${folder}\` open, press {${fg}-fg}w{/} (or {${fg}-fg}.{/} → Generate folder insights). Mycelium distills everything in it into one KNOWLEDGE.md.`,
  'tutorial.step6Title': '',
  'tutorial.step6Body': (fg) => `Review the knowledge draft, then press {${fg}-fg}Enter{/} to save it. Next: see exactly what a new session here would inherit from it.`,
  'tutorial.step7Title': ' — Reuse',
  'tutorial.step7Body': (fg) =>
    `Press {${fg}-fg}n{/} (or {${fg}-fg}.{/} → New task with folder context) to start a new agent session with this folder's context. You'll pick an agent, then a directory. This tutorial always copies the launch command instead of actually opening one, so it's safe to click through.`,
  'tutorial.step8Title': '',
  'tutorial.step8Body': (_fg) =>
    `Pick any agent, then the suggested directory.\n\n` +
    `A real AGENTS.md just got written into that directory, and the copied command even asks the agent to summarize what it inherited. Paste it into a new terminal tab to see for yourself, or check the file (or the project context) directly.`,
  'tutorial.step9Title': '',
  'tutorial.step9Body': (fg) =>
    `For reference, agents differ in how long they keep sessions. Claude Code prunes old sessions after 30 days by default, while Codex and Kiro just keep accumulating them. Mycelium captures and preserves each session independently at scan time, so even if the original is gone or you switch agents, {${fg}-fg}n{/} still starts a new task carrying that folder's context, and {${fg}-fg}h{/} still hands the current task off to another agent from where it left off. So it's not just about keeping logs around, it turns past work into something you can pick back up. Press {${fg}-fg}Enter{/} to continue.`,
  'tutorial.step10Title': ' — Knowledge Review',
  'tutorial.step10Body': (fg) =>
    `That was one folder, by hand. Every folder's knowledge can also be refreshed in one place. Press {${fg}-fg}k{/} to check for (or compute) today's knowledge updates, unrelated to Digest.`,
  'tutorial.step11Title': '',
  'tutorial.step11Body': (fg) =>
    `Everything's pre-checked. Press {${fg}-fg}Enter{/} to approve. This writes KNOWLEDGE.md AND injects straight into AGENTS.md wherever each folder's sessions have run, all in one step.`,
  'tutorial.step12Title': ' — Merge',
  'tutorial.step12Body': (fg) =>
    `These sessions are actually one story. In the Sessions panel, select each with {${fg}-fg}Space{/}, then press {${fg}-fg}Shift+M{/} (or {${fg}-fg}.{/} → Merge sessions) to merge them into one continuous record.`,
  'tutorial.step13Title': '',
  'tutorial.step13Body': (fg) => `Type a title (or leave it blank for a default), then press {${fg}-fg}Enter{/}.`,
  'tutorial.step14Title': ' — Split',
  'tutorial.step14Body': (fg, count, folder) =>
    `Fully reversible, the other direction too. The merged session stayed right here in \`${folder}\`. With it selected, press {${fg}-fg}Shift+S{/} (or {${fg}-fg}.{/} → Split session) for topic-boundary suggestions.`,
  'tutorial.step15Title': '',
  'tutorial.step15Body': (fg) => `Press {${fg}-fg}*{/} to select all the proposed ranges, then {${fg}-fg}Enter{/} to apply.`,
  'tutorial.step16Title': '',
  'tutorial.step16Body': (fg) =>
    `Press {${fg}-fg}/{/} and search for a keyword you remember from these sessions, then press {${fg}-fg}v{/} to check the calendar and find the date they're on. Press {${fg}-fg}Enter{/} to continue.`,
  'tutorial.step17Title': ' — Complete!',
  'tutorial.step17Body': (fg) =>
    `That's the full lifecycle. Day to day, it's a simple loop, the {bold}Context Flywheel{/}: {${fg}-fg}s{/} capture → {${fg}-fg}o{/} organize → {${fg}-fg}w{/} learn → {${fg}-fg}n{/} start the next session with everything it needs. Most of that already happens by itself in the background; Mycelium keeps capturing, organizing, and refreshing what it's learned on its own, so pressing these keys is mostly just reviewing and confirming what's already waiting for you, not starting the work from scratch.\n\n` +
    `Forget a key? Press {${fg}-fg}.{/} for the menu instead. Press {${fg}-fg}q{/} when you're done; the mock sessions get cleaned up and you're switched over to your own, existing data.`,
  // Interim text shown while a real handler is in flight (o/w/k/Shift+S's
  // LLM calls are mocked during the tutorial — see tutorial-mock-llm.js —
  // so these resolve almost instantly, but the narrator still has to wait
  // for the actual modal to open/close (see tutorial.js's isModalOpen
  // polling) rather than trusting the raw keypress alone).
  'tutorial.waitingPalette': 'Waiting for the action menu to open…',
  'tutorial.waitingPaletteClose': 'Closing the action menu…',
  'tutorial.waitingOrganize': 'Reading sessions and drafting folder suggestions…',
  'tutorial.waitingApply': 'Applying…',
  'tutorial.waitingKnowledge': "Distilling this folder's sessions into a knowledge draft…",
  'tutorial.waitingSave': 'Saving…',
  // Near-instant, synchronous menu() open, same as waitingPalette — not an
  // LLM-call wait like waitingOrganize/waitingKnowledge.
  'tutorial.waitingLaunch': 'Waiting for the agent picker to open…',
  // Seeds the tutorial's copied launch command (doNewAgent(), sessions.js)
  // with a prompt, so pasting it into a new tab makes the agent report
  // back what it inherited immediately, instead of sitting at a blank
  // prompt with nothing to demonstrate the injection actually happened.
  'tutorial.newAgentSeed': 'What do you already know about this project? Summarize the context you inherited before I ask anything else.',
  'tutorial.waitingKnowledgeReview': 'Checking today\'s active folders for a knowledge refresh…',
  'tutorial.waitingMerge': "Waiting for Shift+M — make sure you've selected two sessions with Space first.",
  'tutorial.waitingSplit': 'Analyzing the merged session for topic boundaries…',

  // pickers.js
  'picker.newLabel': '{gray-fg}New (unfiled){/}',
  'picker.folderLabel': ' Choose folder (Enter, Esc cancel) ',
  'picker.createNew': '+ Type a new one…',
  'picker.newPathPrompt': 'New folder path (e.g. company/platform/auth)',
  'picker.tagEditPrompt': (shown) => `Edit tags — current: ${shown}\n+add -remove (e.g. +urgent -miscategorized)`,

  // title-edit modal (sessions.js doEditTitle)
  'editor.titlePrompt': 'Edit title',
  'editor.descPrompt': 'Edit description',
  'backlog.titlePrompt': 'Backlog title — what do you want to work on?',
  'backlog.descPrompt': 'Notes for the agent (optional)',
  'backlog.created': (folder) => `Backlog item added to ${folder}`,
  'backlog.needsTitle': 'A backlog item needs a title',
  'editor.notFound': 'Session not found',
  'editor.saved': 'Title saved (Mycelium only — original log unchanged)',
  'editor.saveFailed': (err) => `Save failed: ${err}`,

  // Action menu (sessions.js openActionMenu — the `.` "what do you want to
  // do?" palette; each label shows its own single-key shortcut too)
  'actions.title': 'What do you want to do?  (Esc to go back)',
  'actions.groupSession': 'SESSION',
  'actions.groupFolder': 'FOLDER',
  'actions.scan': 'Scan for new sessions',
  'actions.organize': 'Organize session (auto-file)',
  'actions.merge': 'Merge sessions',
  'actions.split': 'Split session',
  'actions.knowledge': 'Generate folder insights',
  'actions.handoff': 'Continue on another agent',
  'actions.newAgent': 'New task with folder context',
  'actions.newBacklog': 'Add a backlog item (start it later)',
  'actions.openBacklog': 'Start this backlog item now',
  'actions.lineage': 'View details',

  // launch.js
  'launch.noAgents': 'No agent CLI installed (claude/codex/kiro-cli/opencode)',
  'launch.selectAgent': 'Choose agent',
  'launch.selectAgentHandoff': 'Continue this task on another agent — choose agent',
  'launch.selectAgentNew': "New task with this folder's context — choose agent",
  'launch.selectAgentBacklog': 'Start this backlog item — choose agent',
  'launch.chooseAction': 'Start session',
  'launch.selectAgentFallback': "Can't resume (merged/split session) — choose agent; this will be replaced by the new session",
  'launch.dirNotFound': "Directory doesn't exist",
  'launch.dirMissingPrompt': (dir) => `Directory doesn't exist:\n${dir}\nCreate it?`,
  'launch.dirCreate': 'Create it',
  'launch.dirCreateCancel': 'Cancel',
  'launch.dirCreated': (dir) => `Created ${dir}`,
  'launch.dirCreateFailed': (msg) => `Couldn't create directory: ${msg}`,
  'launch.dirNotADirectory': (dir) => `Not a directory (a file exists at that path):\n${dir}`,
  'launch.dirPrompt': (folder) => `Working directory${folder ? ` (${folder})` : ''}`,
  'launch.typeManually': '+ Type one in…',
  'launch.selectDir': (folder) => `Choose working directory (${folder})`,
  'launch.binNotInstalled': (bin) => `${bin} isn't installed`,
  'launch.noWorkDir': 'Original working directory is gone (worktree removed etc.) — use handoff (h) instead.',
  'launch.continuedSession': 'Continued session',
  'launch.newSession': 'New session',
  'launch.captured': (note, n, folder) => `${note} ${n} → ${folder}`,
  'launch.noNewSessions': 'No new sessions from this directory',
  'launch.captureFailed': (msg) => `Capture failed: ${msg}`,

  'resume.chooseAction': 'Resume session',
  'resume.openHere': 'Open here',
  'resume.copyCommand': 'Copy command (new tab)',
  'resume.copied': (line) => `Command copied to clipboard:\n${line}`,
  'resume.copyFailed': (line) => `Copy failed (no clipboard tool found) — command:\n${line}`,
  'resume.expiredTitle': (label) => `${label} session no longer available — continue via Handoff?`,
  'resume.expiredHandoff': 'Continue via Handoff',
  'resume.expiredTryAnyway': 'Try resuming anyway',

  'merge.needsTwo': 'Select 2 or more sessions first (Space)',
  'merge.titlePrompt': 'Title for the merged session (optional)',
  'merge.summarizing': 'Summarizing merged session…',
  'merge.done': (n, id) => `Merged ${n} sessions — undo with \`mycelium unmerge ${id}\``,
  'merge.reverted': (n) => `Merge undone — ${n} original session${n === 1 ? '' : 's'} restored`,

  'split.suggesting': 'Analyzing session for topic boundaries…',
  'split.reviewTitle': 'Proposed split',
  'split.turnRangeLabel': (from, to, label) => `Turn ${from}-${to}  "${label}"`,
  'split.summarizing': 'Summarizing split pieces…',
  'split.done': (n, id) => `Split into ${n} session${n === 1 ? '' : 's'} — undo with \`mycelium unsplit ${id}\``,
  'split.reverted': (n) => `Split undone — ${n} piece${n === 1 ? '' : 's'} removed`,

  'smart.running': 'Summarizing + classifying sessions…',
  'smart.noMatches': 'No confident folder matches found',
  'smart.noMatch': '(no match)',
  'smart.newFolder': 'new folder',
  'smart.previewTitle': 'Suggested placements',
  'smart.pendingOnOpen': (n) => `${n} suggestion${n === 1 ? '' : 's'} waiting — press o to review`,
  'smart.summarizeStoppedEarly': (done, total) =>
    `Stopped after summarizing ${done}/${total} — looks like your Claude/Codex usage limit was hit. Your progress is saved; press o again later to continue.`,
  'smart.placementsStoppedEarly': (err) => `Some placements failed (${err}) — showing what did come back. Press o again later for the rest.`,

  // calendar.js — Calendar tab (v key toggles Sessions ↔ Calendar)
  'calendar.header': 'Calendar',
  'calendar.gridLabel': ' Calendar (←→ day, ↑↓ week, PgUp/PgDn month, Enter →) ',
  'calendar.sessionCount': (n) => `${n} session${n === 1 ? '' : 's'}`,
  'calendar.dayListLabel': (date, n) => ` ${date} — ${n} session${n === 1 ? '' : 's'} `,
  'calendar.detailLabel': ' Detail ',
  'calendar.tabHint': '←→ day  ↑↓ week  PgUp/PgDn month  Enter/→ drill in  r resume  h handoff  Esc/← back  v Sessions',

  'help.text': null, // filled in below (large block)
};

const ko = {
  'app.needsTty': 'Mycelium TUI는 실제 터미널(TTY)에서 실행하세요.',
  'app.confirmQuitTitle': '종료할까요?',
  'app.confirmQuitHint': (fg) => `{${fg}-fg}q{/}를 한 번 더 누르면 종료, 다른 키를 누르면 취소합니다.`,
  'app.confirmLanguageTitle': '언어를 전환할까요?',
  'app.confirmLanguageHint': (fg, label) =>
    `{${fg}-fg}l{/}을 한 번 더 누르면 ${label}(으)로 전환합니다 (Mycelium이 재시작됩니다), 다른 키를 누르면 취소합니다.`,
  'common.cancel': '취소',
  'common.delete': '삭제',
  'common.none': '(없음)',
  'common.noContent': '(내용 없음)',
  'common.searchPrompt': '검색',
  'folders.root': 'Root',
  'folders.new': 'New',
  'sessions.foldersPanelLabel': ' 폴더 ',
  'sessions.sessionsPanelLabel': ' 세션 ',
  'sessions.detailPanelLabel': ' 상세 ',
  'sessions.newBadge': 'New',
  'sessions.mergedBadge': '병합됨',
  'sessions.splitBadge': '분할됨',
  'sessions.linkedBadge': '연결됨',
  'sessions.resumedBadge': '이어받음',
  'sessions.handoffBadge': '이어감',
  'sessions.backlogBadge': '백로그',
  'sessions.backlogOpenedBadge': '시작함',

  'folders.newPrompt': (parent) => `새 폴더 이름${parent ? ` (${parent} 아래)` : ' (루트)'}`,
  'folders.created': (path) => `폴더 생성: ${path}`,
  'folders.cannotRenameRoot': 'Root는 이름을 바꿀 수 없습니다',
  'folders.renamePrompt': (f) => `이름 변경: ${f}`,
  'folders.renamed': (to) => `이름 변경: ${to}`,
  'folders.cannotMoveRoot': 'Root는 옮길 수 없습니다',
  'folders.movedTo': (to) => `이동: ${to}`,
  'folders.cannotDeleteRoot': 'Root는 삭제할 수 없습니다',
  'folders.deleteConfirmTitle': (f) => `"${f}" 삭제?`,
  'folders.deleteConfirmYes': (newLabel) => `삭제 (세션은 미분류로, ${newLabel}에 표시)`,
  'folders.deleted': (moved) => `삭제됨 (세션 ${moved}개 → 미분류)`,
  'folders.selectFirst': '폴더를 먼저 선택하세요',

  'sessions.empty': '세션 없음',
  'sessions.movedTo': (n, folder) => `${n}개 세션 → ${folder}`,
  'sessions.tagsUpdated': (n) => `${n}개 세션 태그 갱신`,
  'sessions.deleteConfirmTitle': (n) => `${n}개 세션 삭제? (Mycelium에서만 삭제, 원본 로그는 유지)`,
  'sessions.deleted': (n) => `${n}개 세션 삭제됨`,
  'sessions.summarizing': (i, n) => `요약·태깅 생성 중… (${i}/${n})`,
  'sessions.summarizingLabel': '요약·태깅 생성 중…',
  'sessions.summarizeDone': (done, failed, lastError) =>
    `요약·태깅 완료: ${done}개${failed ? ` (실패 ${failed}개${lastError ? `: ${lastError}` : ''})` : ''}`,
  'sessions.copied': '세션 내용을 클립보드에 복사함',
  'sessions.copyFailed': '복사 도구(pbcopy 등)를 찾지 못함',
  'sessions.sortLabel_title': '정렬: 제목순',
  'sessions.sortLabel_agent': '정렬: 에이전트순',
  'sessions.sortLabel_title-desc': '정렬: 제목 역순',
  'sessions.sortLabel_date-asc': '정렬: 오래된순',
  'sessions.sortLabel_date-desc': '정렬: 최신순',
  'sessions.sortPickerTitle': '정렬 기준',
  'sessions.sortOption_recent': '최신순',
  'sessions.sortOption_dateAsc': '오래된순',
  'sessions.sortOption_title': '제목 A → Z',
  'sessions.sortOption_titleDesc': '제목 Z → A',
  'sessions.unfiledHint': (n) => `${n}개 세션을 가져왔지만 아직 폴더가 없습니다 — o를 눌러 내용 기준으로 정리해보세요`,
  'sessions.firstScanModalLabel': ' 첫 스캔 완료 — 아직 정리되지 않음 (Enter/Esc로 닫기) ',
  'sessions.firstScanBody': (n, fg) =>
    `{bold}${n}개 세션을 가져왔지만 아직 정리되지 않았습니다.{/} {${fg}-fg}o{/}를 눌러 내용 기준으로 전부 정리해보세요 — Mycelium이 각 세션을 읽고 분류하는데, 세션이 많으면 실제로 시간이 걸립니다. 그 동안 다른 작업을 하다 와도 괜찮습니다 — 계속 진행되고 있으니, 준비되면 돌아와서 제안 내용을 검토하세요.\n\n` +
    `팁: 필요 없는 세션이 있다면 {${fg}-fg}Space{/}로 선택한 뒤 {${fg}-fg}x{/}로 삭제하세요 — 세션이 적을수록 o를 눌렀을 때 LLM 호출도 줄어듭니다.`,
  'detail.noSummary': '(요약 없음 — 세션에서 a를 눌러 요약·태깅 생성)',
  'detail.lastActive': '최근 활동',
  'detail.firstRequest': '첫 요청:',
  'detail.id': 'ID:',
  'detail.summary': '요약',
  'detail.decisions': '결정',
  'detail.todos': '실행 항목',
  'detail.continuationOf': (label) => `이어받음: ${label}`,
  'detail.continuedTo': (label) => `이어감: ${label}`,
  'detail.fromBacklog': (label) => `백로그에서 시작: ${label}`,
  'detail.backlogStarted': (label) => `시작된 세션: ${label}`,
  'detail.mergedFrom': (n, labels) => `${n}개 병합됨: ${labels}`,
  'detail.splitFrom': (label) => `분할됨 — 원본: ${label}`,
  'detail.superseded': (labels) => `대체됨: ${labels}`,
  'detail.splitInto': (n, labels) => `${n}개로 분할됨: ${labels}`,

  'lifecycle.bar': (fg) =>
    `캡처·{${fg}-fg}s{/} → 정리·{${fg}-fg}o{/} → 학습·{${fg}-fg}w{/} → 재사용·{${fg}-fg}n{/}`,

  'status.helpFallback': '. 메뉴   ? 전체 단축키   q 종료',

  'scan.inProgress': '스캔 중…',
  'scan.failed': (msg) => `스캔 실패: ${msg}`,
  'scan.done': (imported, scanned, skipped, failed) =>
    `스캔 +${imported} (총 ${scanned}, 건너뜀 ${skipped}${failed ? `, 실패 ${failed}` : ''})`,

  'knowledge.generating': '지식 초안 생성 중…',
  'knowledge.previewTitle': (folder) => `KNOWLEDGE.md 미리보기 · ${folder}`,
  'knowledge.cancelled': '취소됨 — KNOWLEDGE.md 변경 없음',
  'knowledge.saved': (folder) => `KNOWLEDGE.md 저장: ${folder}`,
  'knowledge.reviewRunning': '오늘 활동이 있었던 폴더를 확인해 지식을 갱신하는 중…',
  'knowledge.reviewNone': '지금 검토할 지식 업데이트가 없습니다',
  'knowledge.reviewTitle': '지식 업데이트 검토',
  'knowledge.injectDirsTitle': '어느 디렉터리에 주입할까요?',
  'knowledge.reviewApplied': (n) => `${n}개 폴더의 KNOWLEDGE.md를 갱신하고 AGENTS.md에 주입했습니다`,
  'knowledge.reviewSkipped': '적용된 변경 사항 없음',
  'knowledge.pendingOnOpen': (n) => `${n}개 폴더에 지식 업데이트가 준비됐어요 — k로 검토`,
  'context.title': (folder) => `컨텍스트 · ${folder}`,
  'context.empty': '(상속할 컨텍스트 없음)',
  'context.needsFolder': '폴더가 있는 세션에서만 가능합니다',
  'inject.dirPrompt': 'AGENTS.md를 주입할 디렉토리',
  'inject.noKnowledge': (folder) => `주입할 KNOWLEDGE.md가 없습니다: ${folder}`,
  'inject.previewTitle': (dir) => `${dir}/AGENTS.md 에 주입할 내용`,
  'inject.cancelled': '취소됨 — AGENTS.md 변경 없음',
  'inject.done': (dir) => `AGENTS.md 주입: ${dir}`,

  'export.summary': '## 요약',
  'export.decisions': '## 결정',
  'export.todos': '## 할 일',
  'export.files': '## 파일',
  'export.conversation': '## 대화',

  'viewer.textViewLabel': (title) => ` ${title} (↑↓ 스크롤, y 복사, Esc 닫기) `,
  'viewer.copiedLabel': (title) => ` ${title} (복사됨) `,
  'viewer.copyFailedLabel': (title) => ` ${title} (복사 실패) `,
  'viewer.confirmLabel': (title) => ` ${title} (↑↓ 스크롤, y/Enter 저장, n/Esc 취소) `,
  'digest.label': ' 다이제스트 (Enter 열기, n 오늘 생성, w 이번주 생성, Esc 닫기) ',
  'digest.empty': '{gray-fg}(없음 — n/w로 생성){/}',
  'digest.generating': ' 다이제스트 생성 중… ',
  'digest.generated': (keyed) => ` 생성: ${keyed} `,
  'digest.failed': (err) => ` 실패: ${err} `,
  'digest.readFailed': '(읽기 실패)',
  'help.modalLabel': ' 단축키 도움말 (↑↓ 스크롤, Esc/? 닫기) ',
  'welcome.modalLabel': ' Mycelium에 오신 것을 환영합니다 (Enter/Esc로 시작) ',
  'welcome.body': null,

  'demo.handoffTransition': '마무리하는 중 — 실제 데이터로 전환합니다…',

  'tutorial.promptTitle': '처음 오셨네요! 짧은 인터랙티브 튜토리얼 보시겠어요?',
  'tutorial.promptYes': '튜토리얼 시작하기',
  'tutorial.promptNo': '건너뛰고 바로 시작하기',
  'tutorial.personaPromptTitle': '누구의 작업을 따라가 볼까요?',
  'tutorial.exitHint': 'q: 튜토리얼 종료',
  'tutorial.finishHint': 'q: 마치고 실제 데이터로 전환',
  'tutorial.stepCounter': (n, total) => `${n}/${total}단계`,
  'tutorial.introTitle': '',
  'tutorial.introBody': (fg) =>
    `{bold}Mycelium에 오신 걸 환영합니다{/}: AI 세션을 정리하고, 그 안의 지식을 다음 세션으로 이어줍니다. {${fg}-fg}Capture → Organize → Learn → Reuse{/} 흐름으로 동작합니다. Claude Code, Codex, Kiro, OpenCode의 모든 세션이 자동으로 캡처됩니다. 이 투어는 그 세션들을 잃어버리지 않고 계속 쓸모 있게 만드는 흐름을 보여줍니다.\n\n` +
    `세 개의 패널(폴더 → 세션 → 상세)은 {${fg}-fg}→{/}/{${fg}-fg}←{/}로 이동합니다. 지금 {${fg}-fg}Enter{/}를 눌러 첫 폴더로 들어가 시작하세요.`,
  'tutorial.stepPaletteTitle': ' — 메뉴',
  'tutorial.stepPaletteBody': (fg) =>
    `단축키를 외울 필요 없이, 폴더와 세션에서 {${fg}-fg}.{/}를 누르면 각각 지금 실행해볼 수 있는 것들의 메뉴가 나옵니다. 각 항목에 단축키가 함께 표시되고, SESSION(세션 대상)과 FOLDER(폴더 대상)로 묶여 있습니다.`,
  'tutorial.stepPaletteAckTitle': '',
  'tutorial.stepPaletteAckBody': (fg) =>
    `이게 전부입니다. {${fg}-fg}Esc{/}로 닫으세요.\n\n` +
    `이후 스텝 중 이 메뉴에도 있는 동작(정리, 지식 추출, 캡처, 병합, 분할)이라면, 그 키를 직접 눌러도 되고 {${fg}-fg}.{/}로 메뉴를 열어서 해당 항목을 골라도 됩니다. 결과는 완전히 동일합니다.`,
  'tutorial.stepScanTitle': ' — 캡처',
  'tutorial.stepScanBody': (fg) =>
    `아직 아무 세션도 캡처되지 않았습니다. {${fg}-fg}s{/}를 눌러 (또는 {${fg}-fg}.{/} → 새 세션 스캔) AI 세션들을 가져와보세요. 루프의 첫 단계인 Capture이며, Claude Code, Codex, Kiro, OpenCode를 대상으로 백그라운드에서 조용히 도는 것과 동일한 동작입니다.`,
  'tutorial.step2Title': ' — 조직화',
  'tutorial.step2Body': (fg, count) => `아직 정리 안 된 세션 ${count}개가 아래에 있습니다. {${fg}-fg}o{/}를 눌러 (또는 {${fg}-fg}.{/} → 세션 정리) Mycelium이 내용을 읽고 폴더를 제안하게 해보세요.`,
  'tutorial.step3Title': '',
  'tutorial.step3Body': (fg) => `제안된 폴더를 확인하고 {${fg}-fg}Enter{/}로 적용해보세요.`,
  'tutorial.step4Title': '',
  'tutorial.step4Body': (fg, count, folder) =>
    `폴더가 자동으로 생성되고 세션들이 정리됐습니다. 관련 세션 여럿이 \`${folder}\`로 함께 모였습니다. {${fg}-fg}←{/}로 Folders 패널로 돌아간 뒤 {${fg}-fg}↓{/}로 찾고 {${fg}-fg}Enter{/}/→로 열어보세요.`,
  'tutorial.step5Title': ' — 학습',
  'tutorial.step5Body': (fg, count, folder) => `\`${folder}\`를 연 상태에서 {${fg}-fg}w{/}를 눌러보세요 (또는 {${fg}-fg}.{/} → 폴더 안의 인사이트 생성). 그 폴더의 모든 세션을 하나의 KNOWLEDGE.md로 압축합니다.`,
  'tutorial.step6Title': '',
  'tutorial.step6Body': (fg) => `지식 초안을 확인하고 {${fg}-fg}Enter{/}로 저장하세요. 다음: 새 세션이 여기서 무엇을 물려받는지 직접 확인해봅니다.`,
  'tutorial.step7Title': ' — 재사용',
  'tutorial.step7Body': (fg) =>
    `{${fg}-fg}n{/}을 눌러 (또는 {${fg}-fg}.{/} → 폴더 컨텍스트로 새 작업) 이 폴더의 컨텍스트로 새 에이전트 세션을 시작해보세요. 에이전트를 고른 뒤 디렉토리를 고르게 됩니다. 이 튜토리얼은 실제로 여는 대신 항상 실행 명령을 복사하므로 마음 편히 클릭해도 됩니다.`,
  'tutorial.step8Title': '',
  'tutorial.step8Body': (_fg) =>
    `아무 에이전트나 고른 뒤 제안된 디렉토리를 선택하세요.\n\n` +
    `그 디렉토리에 실제 AGENTS.md가 방금 작성되었고, 복사된 명령어에는 물려받은 내용을 요약해달라는 프롬프트까지 들어있습니다. 새 터미널 탭에 붙여넣어 직접 확인해보거나, 파일(또는 프로젝트 컨텍스트)을 바로 확인해보세요.`,
  'tutorial.step9Title': '',
  'tutorial.step9Body': (fg) =>
    `참고로 에이전트마다 세션 보존 방식이 다릅니다. Claude Code는 기본 30일 후 오래된 세션을 정리하고, Codex와 Kiro는 장기간 누적합니다. 이때 Mycelium은 세션을 캡처 시점에 독립적으로 보존하기 때문에, 원본이 사라지거나 에이전트를 바꿔도 {${fg}-fg}n{/}은 그 폴더의 맥락을 물려받아 새 작업을 시작하고, {${fg}-fg}h{/}는 지금까지의 작업을 다른 에이전트로 그대로 넘겨줍니다. 따라서 로그를 보존하는 것을 넘어, 과거의 기록을 다시 이어지는 작업으로 만듭니다. {${fg}-fg}Enter{/}로 계속하세요.`,
  'tutorial.step10Title': ' — 지식 검토',
  'tutorial.step10Body': (fg) =>
    `방금은 폴더 하나를 손으로 했죠. 모든 폴더의 지식을 한 곳에서 한 번에 갱신할 수도 있습니다. {${fg}-fg}k{/}를 눌러 오늘의 지식 업데이트를 확인(또는 계산)해보세요. Digest와는 무관한 별개 기능입니다.`,
  'tutorial.step11Title': '',
  'tutorial.step11Body': (fg) =>
    `전부 기본으로 체크되어 있습니다. {${fg}-fg}Enter{/}를 눌러 승인하세요. 이 한 번으로 각 폴더의 KNOWLEDGE.md를 갱신하고, 그 폴더의 세션들이 실행됐던 모든 곳의 AGENTS.md에도 바로 주입됩니다.`,
  'tutorial.step12Title': ' — 병합',
  'tutorial.step12Body': (fg) =>
    `이 세션들은 사실 하나의 이야기입니다. 세션 창에서 각 세션들을 {${fg}-fg}Space{/}로 선택한 뒤 {${fg}-fg}Shift+M{/}으로 (또는 {${fg}-fg}.{/} → 세션 병합) 하나의 연속된 기록으로 병합해보세요.`,
  'tutorial.step13Title': '',
  'tutorial.step13Body': (fg) => `제목을 입력하거나(비워두면 기본값) {${fg}-fg}Enter{/}를 누르세요.`,
  'tutorial.step14Title': ' — 분할',
  'tutorial.step14Body': (fg, count, folder) =>
    `반대 방향도 완전히 되돌릴 수 있습니다. 병합된 세션은 그대로 \`${folder}\`에 남아 있습니다. 선택된 상태에서 {${fg}-fg}Shift+S{/}로 (또는 {${fg}-fg}.{/} → 세션 분할) 세션을 나눌 지점 제안을 받아보세요.`,
  'tutorial.step15Title': '',
  'tutorial.step15Body': (fg) => `{${fg}-fg}*{/}로 제안된 구간을 모두 선택한 뒤 {${fg}-fg}Enter{/}로 적용하세요.`,
  'tutorial.step16Title': '',
  'tutorial.step16Body': (fg) =>
    `{${fg}-fg}/{/}를 눌러 방금 본 세션들에서 기억나는 키워드로 검색해보고, {${fg}-fg}v{/}를 눌러 캘린더에서 해당 세션이 있는 날짜를 확인해보세요. {${fg}-fg}Enter{/}로 계속하세요.`,
  'tutorial.step17Title': ' — 완료!',
  'tutorial.step17Body': (fg) =>
    `전체 라이프사이클을 다 보셨습니다. 일상적으로는 단순한 반복입니다, 바로 {bold}Context Flywheel{/}: {${fg}-fg}s{/} 캡처 → {${fg}-fg}o{/} 정리 → {${fg}-fg}w{/} 학습 → {${fg}-fg}n{/} 필요한 모든 게 준비된 채로 다음 세션 시작. 대부분은 이미 백그라운드에서 저절로 돌아갑니다. Mycelium이 알아서 캡처하고 정리하고 배운 것을 갱신해둡니다. 이 키들을 누르는 건 대부분 처음부터 뭔가 시작시키는 게 아니라 이미 준비된 걸 검토/확인하는 것에 가깝습니다.\n\n` +
    `키가 기억나지 않으면 {${fg}-fg}.{/}로 메뉴를 열어보세요. 다 보셨으면 {${fg}-fg}q{/}를 누르세요. 데모 세션이 정리되고 원래(기존) 데이터로 전환됩니다.`,
  'tutorial.waitingPalette': '액션 메뉴가 열리기를 기다리는 중…',
  'tutorial.waitingPaletteClose': '액션 메뉴를 닫는 중…',
  'tutorial.waitingOrganize': '세션을 읽고 폴더를 제안하는 중…',
  'tutorial.waitingApply': '적용하는 중…',
  'tutorial.waitingKnowledge': '이 폴더의 세션들을 지식 초안으로 압축하는 중…',
  'tutorial.waitingSave': '저장하는 중…',
  'tutorial.waitingLaunch': '에이전트 선택 메뉴가 열리기를 기다리는 중…',
  'tutorial.newAgentSeed': '이 프로젝트에 대해 이미 알고 있는 게 있다면 무엇인가요? 다른 걸 묻기 전에, 물려받은 컨텍스트를 먼저 요약해 주세요.',
  'tutorial.waitingKnowledgeReview': '오늘 활동이 있었던 폴더를 확인해 지식을 갱신하는 중…',
  'tutorial.waitingMerge': 'Shift+M을 기다리는 중 — 먼저 Space로 세션 두 개를 선택했는지 확인하세요.',
  'tutorial.waitingSplit': '병합된 세션을 나눌 지점을 찾는 중…',

  'picker.newLabel': '{gray-fg}New (미분류){/}',
  'picker.folderLabel': ' 폴더 선택 (Enter, Esc 취소) ',
  'picker.createNew': '+ 새 폴더 입력…',
  'picker.newPathPrompt': '새 폴더 경로 (예: 회사/플랫폼/인증)',
  'picker.tagEditPrompt': (shown) => `태그 편집 — 현재: ${shown}\n+추가 -삭제 (예: +긴급 -오분류)`,

  'editor.titlePrompt': '제목 수정',
  'editor.descPrompt': '설명 수정',
  'backlog.titlePrompt': '백로그 제목 — 무엇을 할 예정인가요?',
  'backlog.descPrompt': '에이전트에게 남길 메모 (선택)',
  'backlog.created': (folder) => `백로그 추가: ${folder}`,
  'backlog.needsTitle': '백로그에는 제목이 필요합니다',
  'editor.notFound': '세션을 찾을 수 없습니다',
  'editor.saved': '제목 저장됨 (Mycelium 전용, 원본 로그는 변경 없음)',
  'editor.saveFailed': (err) => `저장 실패: ${err}`,

  'actions.title': '무엇을 할까요?  (Esc로 뒤로)',
  'actions.groupSession': 'SESSION',
  'actions.groupFolder': 'FOLDER',
  'actions.scan': '새 세션 스캔',
  'actions.organize': '세션 정리 (자동 분류)',
  'actions.merge': '세션 병합',
  'actions.split': '세션 분할',
  'actions.knowledge': '폴더 안의 인사이트 생성',
  'actions.handoff': '다른 에이전트로 작업을 이어서',
  'actions.newAgent': '폴더 컨텍스트로 새 작업 시작',
  'actions.newBacklog': '백로그 추가 (나중에 시작)',
  'actions.openBacklog': '이 백로그 지금 시작',
  'actions.lineage': '상세 보기',

  'launch.noAgents': '설치된 에이전트(claude/codex/kiro-cli/opencode)가 없습니다',
  'launch.selectAgent': '에이전트 선택',
  'launch.selectAgentHandoff': '하던 작업을 다른 에이전트로 이어서 — 에이전트 선택',
  'launch.selectAgentNew': '이 폴더 컨텍스트로 새 작업 — 에이전트 선택',
  'launch.selectAgentBacklog': '이 백로그를 시작 — 에이전트 선택',
  'launch.chooseAction': '세션 시작',
  'launch.selectAgentFallback': '이어열기 불가(병합/분할된 세션) — 에이전트 선택, 이 세션은 새 세션으로 대체됩니다',
  'launch.dirNotFound': '디렉토리가 존재하지 않습니다',
  'launch.dirMissingPrompt': (dir) => `이 경로가 없습니다:\n${dir}\n새로 만들까요?`,
  'launch.dirCreate': '만들기',
  'launch.dirCreateCancel': '취소',
  'launch.dirCreated': (dir) => `생성함: ${dir}`,
  'launch.dirCreateFailed': (msg) => `디렉토리 생성 실패: ${msg}`,
  'launch.dirNotADirectory': (dir) => `디렉토리가 아닙니다 (이 경로에 파일이 있어요):\n${dir}`,
  'launch.dirPrompt': (folder) => `작업 디렉토리${folder ? ` (${folder})` : ''}`,
  'launch.typeManually': '+ 직접 입력…',
  'launch.selectDir': (folder) => `작업 디렉토리 선택 (${folder})`,
  'launch.binNotInstalled': (bin) => `${bin}가 설치되어 있지 않습니다`,
  'launch.noWorkDir': '원래 작업 디렉토리가 없어 이어열 수 없습니다 (워크트리 삭제 등). 핸드오프(h)를 쓰세요.',
  'launch.continuedSession': '이어받은 세션',
  'launch.newSession': '새 세션',
  'launch.captured': (note, n, folder) => `${note} ${n}개 → ${folder}`,
  'launch.noNewSessions': '이 디렉토리의 새 세션 없음',
  'launch.captureFailed': (msg) => `캡처 실패: ${msg}`,

  'resume.chooseAction': '세션 이어열기',
  'resume.openHere': '여기서 열기',
  'resume.copyCommand': '명령어 복사 (새 탭용)',
  'resume.copied': (line) => `명령어가 클립보드에 복사됨:\n${line}`,
  'resume.copyFailed': (line) => `복사 실패 (클립보드 도구 없음) — 명령어:\n${line}`,
  'resume.expiredTitle': (label) => `${label} 세션을 더 이상 사용할 수 없음 — 핸드오프로 이어가시겠어요?`,
  'resume.expiredHandoff': '핸드오프로 이어가기',
  'resume.expiredTryAnyway': '그래도 이어열기 시도',

  'merge.needsTwo': '먼저 세션을 2개 이상 선택하세요 (Space)',
  'merge.titlePrompt': '병합된 세션의 제목 (선택 사항)',
  'merge.summarizing': '병합된 세션 요약 중…',
  'merge.done': (n, id) => `${n}개 세션 병합됨 — \`mycelium unmerge ${id}\`로 되돌리기`,
  'merge.reverted': (n) => `병합 취소됨 — 원본 세션 ${n}개 복원`,

  'split.suggesting': '세션을 나눌 지점을 찾는 중…',
  'split.reviewTitle': '분할 제안',
  'split.turnRangeLabel': (from, to, label) => `턴 ${from}-${to}  "${label}"`,
  'split.summarizing': '분할된 세션들 요약 중…',
  'split.done': (n, id) => `${n}개 세션으로 분할됨 — \`mycelium unsplit ${id}\`로 되돌리기`,
  'split.reverted': (n) => `분할 취소됨 — 조각 ${n}개 제거`,

  'smart.running': '세션 요약 + 폴더 분류 중…',
  'smart.noMatches': '확실한 폴더 매칭을 찾지 못했습니다',
  'smart.noMatch': '(매칭 없음)',
  'smart.newFolder': '신규 폴더',
  'smart.previewTitle': '제안된 폴더 배치',
  'smart.pendingOnOpen': (n) => `${n}개 정리 제안 대기 중 — o로 확인`,
  'smart.summarizeStoppedEarly': (done, total) =>
    `${done}/${total}개 요약 후 중단됨 — Claude/Codex 사용량 한도에 도달한 것 같습니다. 지금까지의 진행 상황은 저장되어 있으니, 나중에 다시 o를 눌러 이어서 진행하세요.`,
  'smart.placementsStoppedEarly': (err) => `일부 배치 제안이 실패했습니다 (${err}) — 성공한 것만 표시합니다. 나머지는 나중에 다시 o를 눌러주세요.`,

  // calendar.js — 캘린더 탭 (v 키로 세션 ↔ 캘린더 전환)
  'calendar.header': '캘린더',
  'calendar.gridLabel': ' 캘린더 (←→ 날짜, ↑↓ 주, PgUp/PgDn 월 변경, Enter →) ',
  'calendar.sessionCount': (n) => `${n}개 세션`,
  'calendar.dayListLabel': (date, n) => ` ${date} — ${n}개 세션 `,
  'calendar.detailLabel': ' 상세 ',
  'calendar.tabHint': '←→ 날짜  ↑↓ 주  PgUp/PgDn 월 변경  Enter/→ 상세  r 이어열기  h 핸드오프  Esc/← 뒤로  v 세션으로',

  'help.text': null,
};

// The full ? help modal is one cohesive block per locale rather than composed
// from dozens of sub-keys — it's read as a single reference sheet, and
// splitting it further would add ceremony without adding maintainability.
en['help.text'] = (fg, spore) => `{bold}The Context Flywheel{/}

Day to day, it's a simple loop: {${fg}-fg}s{/} capture → {${fg}-fg}o{/} organize → {${fg}-fg}w{/} learn → {${fg}-fg}n{/} start the next session with everything it needs. Most of that already runs by itself in the background (capture every 5 min, organize suggestions queued, knowledge updates prepared) — pressing these keys is mostly reviewing/confirming what's already waiting, not starting from scratch. Everything below is the full detail behind that loop.

{bold}Global{/}

  {${fg}-fg}s{/}       Scan (mycelium scan, no CLI needed — captures new/changed sessions, no auto-filing; use \`o\` or \`mycelium organize\` to file them)
  {${fg}-fg}o{/}       Smart organize — scoped to wherever you're browsing (Root = unfiled only, a folder = itself + subfolders); suggests folders by content, may propose new folders too — all pre-checked, Enter applies everything, Space to uncheck any
  {${fg}-fg}k{/}       Knowledge review — reviews/refreshes KNOWLEDGE.md across every active folder at once and injects AGENTS.md on approval; reuses whatever the daemon already queued overnight, or computes fresh on the spot. Unrelated to Digest (d)
  {${fg}-fg}/{/}       Full-text search
  {${fg}-fg}v{/}       Toggle to the Calendar tab — full screen, browse by day (press v again to return)
  {${fg}-fg}d{/}       View digests (open, then n/w to generate today/this week)
  {${fg}-fg}.{/}       Action menu — "what do you want to do?" for the selected session, with each key shown (don't want to memorize keys? start here)
  {${fg}-fg}?{/}       This help
  {${fg}-fg}g{/}       Getting-started guide (shown once automatically on first launch)
  {${fg}-fg}q{/}       Quit

{bold}Folders panel{/}

  {${fg}-fg}Enter / →{/}   View this folder's sessions
  {${fg}-fg}a{/}       New (sub)folder
  {${fg}-fg}e{/}       Rename
  {${fg}-fg}m{/}       Move / nest
  {${fg}-fg}x{/}       Delete (sessions become unfiled, shown as New in Root)
  {${fg}-fg}w{/}       Extract folder knowledge (KNOWLEDGE.md) — preview then confirm

{bold}Sessions panel{/}

  {${fg}-fg}Enter / →{/}   View detail
  {${fg}-fg}Esc / ←{/}     Back to folders
  {${fg}-fg}a{/}       Generate summary + tags (LLM, batches over multi-select)
  {${fg}-fg}e{/}       Rename title (modal — summary/tags stay AI-generated)
  {${fg}-fg}y{/}       Copy the whole session to the clipboard. For a snippet, hold Shift (Option on iTerm2) while dragging to bypass mouse tracking, then Cmd+C / Ctrl+Shift+C
  {${fg}-fg}r{/}       Resume (reopen in the original agent, right here — merged/split sessions fall back to handoff instead, which replaces them with the real session it produces)
  {${fg}-fg}h{/}       Continue this task on another agent (handoff) — seeds the new session with where this one left off, plus the folder's context, and links it as a continuation
  {${fg}-fg}b{/}       Add a backlog item — a title + notes for something to work on later, filed in this folder. Press {${fg}-fg}r{/} on it (or Enter in detail) whenever you're ready: an agent starts seeded with those notes, and the session that comes back takes the item's place in the list
  {${fg}-fg}n{/}       Start a NEW task with this folder's context (new agent) — no prior conversation carried over, just the folder's accumulated knowledge. After picking an agent/directory, asks "open here" or "copy command" (paste into a separate terminal tab to run several sessions in parallel)
  {${fg}-fg}m{/} / {${fg}-fg}t{/}   Move to folder / edit tags
  {${fg}-fg}x{/}       Delete session (Mycelium record only, original log kept)
  {${fg}-fg}w{/}       Extract folder knowledge — preview then confirm
  {${fg}-fg}c{/}       View inherited context
  {${fg}-fg}i{/}       Inject into AGENTS.md — preview then confirm (n/h do this automatically; use i to refresh a session opened outside Mycelium)
  {${fg}-fg}Space{/}   Multi-select
  {${fg}-fg}*{/}       Select everything currently listed (press again to clear)
  {${fg}-fg}Shift+M{/} Merge 2+ selected sessions into one (git-like — originals kept, just hidden; mycelium unmerge undoes it)
  {${fg}-fg}Shift+S{/} Split (LLM-suggested topic boundaries, review before applying — pieces land in the same folder, original stays visible; mycelium unsplit undoes it)
  {${fg}-fg}Shift+O{/} Cycle sort order — recent (default) → title A-Z → agent
  {${fg}-fg}Shift+T{/} Pick a sort order directly — newest/oldest first, title A-Z/Z-A

{bold}Detail panel{/}

  {${fg}-fg}↑↓{/}      Scroll
  {${fg}-fg}Enter{/}   Resume — choose "open here" or "copy command" (r in the sessions panel always opens here)
  {${fg}-fg}Esc / ←{/}     Back to sessions
  {${fg}-fg}a / e / y / x{/}  Same as sessions panel

Sessions linked by handoff show {${spore}-fg}↩{/}/{${spore}-fg}→{/} markers in the list and continuation links in detail.`;

en['welcome.body'] = (fg) => `Mycelium keeps AI coding-agent sessions from getting lost —
each one moves through 4 stages, all inside this screen:

{${fg}-fg}Capture{/}   Sessions from Claude Code / Codex / Kiro / OpenCode get pulled in automatically
              (every 5 min while this is open, or press {${fg}-fg}s{/} to do it now).
              Nothing gets sorted into a folder yet at this point.

{${fg}-fg}Organize{/}  Press {${fg}-fg}o{/} to have your captured sessions summarized and sorted
              into folders by what they're actually about — review the
              suggestions, keep the ones that look right.

{${fg}-fg}Learn{/}     {${fg}-fg}a{/} (re)generates a summary/tags for a session; {${fg}-fg}w{/} distills a whole
              folder's sessions into one KNOWLEDGE.md.

{${fg}-fg}Reuse{/}     {${fg}-fg}n{/}/{${fg}-fg}h{/} launch a new agent session already knowing that folder's
              KNOWLEDGE.md; {${fg}-fg}r{/} resumes an existing one.

If you haven't run {${fg}-fg}mycelium scan{/} yet, nothing will be in the list —
press {${fg}-fg}s{/} first. Full keymap anytime: {${fg}-fg}?{/}. This won't pop up again on
its own — press {${fg}-fg}g{/} whenever you want to see it again.`;

ko['help.text'] = (fg, spore) => `{bold}Context Flywheel{/}

일상적으로는 단순한 반복입니다: {${fg}-fg}s{/} 캡처 → {${fg}-fg}o{/} 정리 → {${fg}-fg}w{/} 학습 → {${fg}-fg}n{/} 필요한 모든 게 준비된 채로 다음 세션 시작. 대부분은 이미 백그라운드에서 저절로 돌아갑니다(5분마다 캡처, 정리 제안 대기, 지식 업데이트 준비) — 이 키들을 누르는 건 대부분 처음부터 시작시키는 게 아니라 이미 준비된 걸 검토/확인하는 것에 가깝습니다. 아래는 그 흐름 뒤의 전체 상세입니다.

{bold}전역{/}

  {${fg}-fg}s{/}       스캔 (mycelium scan, CLI 없이 — 새/변경된 세션 캡처만, 자동 배치는 안 함; 배치는 o 또는 mycelium organize로)
  {${fg}-fg}o{/}       스마트 정리 — 지금 보고 있는 범위로 한정(Root=미분류만, 폴더 안=그 폴더+하위만), 새 폴더 제안도 가능 — 전부 체크된 채로 떠서 Enter만으로 전체 적용, 잘못된 것만 Space로 해제
  {${fg}-fg}k{/}       지식 검토 — 활동이 있었던 모든 폴더의 KNOWLEDGE.md를 한 번에 검토/갱신하고 승인 시 AGENTS.md에 주입. 데몬이 밤새 미리 계산해둔 게 있으면 재사용하고, 없으면 그 자리에서 계산. Digest(d)와는 무관
  {${fg}-fg}/{/}       전문 검색
  {${fg}-fg}v{/}       캘린더 탭으로 전환 — 전체 화면, 날짜별로 탐색 (다시 v를 누르면 세션으로 복귀)
  {${fg}-fg}d{/}       다이제스트 보기 (열어서 n/w로 오늘/이번주 생성)
  {${fg}-fg}.{/}       액션 메뉴 — 선택한 세션에 "무엇을 할까요?"를 단축키와 함께 보여줌 (키 외우기 싫으면 여기서 시작)
  {${fg}-fg}?{/}       이 도움말
  {${fg}-fg}g{/}       시작 안내 다시 보기 (처음 실행 시 자동으로 한 번 뜸)
  {${fg}-fg}q{/}       종료

{bold}폴더 패널{/}

  {${fg}-fg}Enter / →{/}   이 폴더의 세션 보기
  {${fg}-fg}a{/}       새 (하위)폴더
  {${fg}-fg}e{/}       이름 변경
  {${fg}-fg}m{/}       이동 / 중첩
  {${fg}-fg}x{/}       삭제 (세션은 미분류로, Root에서 New로 표시)
  {${fg}-fg}w{/}       폴더 지식(KNOWLEDGE.md) 추출 — 미리보기 후 확인

{bold}세션 패널{/}

  {${fg}-fg}Enter / →{/}   상세 보기
  {${fg}-fg}Esc / ←{/}     폴더 패널로
  {${fg}-fg}a{/}       요약·태그 생성 (LLM, 다중 선택 시 일괄)
  {${fg}-fg}e{/}       제목 수정 (모달 — 요약·태그는 AI 생성 그대로)
  {${fg}-fg}y{/}       세션 전체를 클립보드로 복사. 일부만 복사하려면 Shift(iTerm2는 Option)를 누른 채 드래그해서 마우스 추적을 우회한 뒤 Cmd+C / Ctrl+Shift+C
  {${fg}-fg}r{/}       이어열기 (원래 에이전트로, 바로 여기서 — 병합/분할 세션은 핸드오프로 대체되고, 그렇게 생긴 실제 세션이 원래 자리를 대신함)
  {${fg}-fg}h{/}       하던 작업을 다른 에이전트로 이어서 (핸드오프) — 이 세션의 진행상황 + 폴더 컨텍스트를 새 세션에 넣어주고, 후속 세션으로 연결
  {${fg}-fg}b{/}       백로그 추가 — 나중에 할 일의 제목 + 메모를 이 폴더에 적어둡니다. 시작할 준비가 되면 그 항목에서 {${fg}-fg}r{/}(상세에서는 Enter)를 누르세요. 그 메모를 넘겨받은 에이전트가 시작되고, 돌아온 세션이 목록에서 그 자리를 대신합니다
  {${fg}-fg}n{/}       이 폴더 컨텍스트로 새 작업 시작 (새 에이전트) — 이전 대화는 안 넘어가고 폴더에 쌓인 지식만. 에이전트/디렉터리 선택 후 "여기서 열기" 또는 "명령어 복사" 선택 (복사하면 다른 터미널 탭에 붙여넣어 여러 세션을 동시에 실행 가능)
  {${fg}-fg}m{/} / {${fg}-fg}t{/}   폴더 이동 / 태그 편집
  {${fg}-fg}x{/}       세션 삭제 (Mycelium 저장소에서만, 원본 로그 유지)
  {${fg}-fg}w{/}       폴더 지식 추출 — 미리보기 후 확인
  {${fg}-fg}c{/}       상속 컨텍스트 보기
  {${fg}-fg}i{/}       AGENTS.md에 주입 — 미리보기 후 확인 (n/h는 자동으로 함; Mycelium 밖에서 연 세션 새로고침용)
  {${fg}-fg}Space{/}   다중 선택
  {${fg}-fg}*{/}       현재 목록 전체 선택 (다시 누르면 전체 해제)
  {${fg}-fg}Shift+M{/} 선택한 세션 2개 이상 병합 (git처럼 — 원본은 안 지워지고 숨겨질 뿐, mycelium unmerge로 되돌리기)
  {${fg}-fg}Shift+S{/} 분할 (LLM이 세션을 나눌 지점 제안, 검토 후 적용 — 조각은 원본과 같은 폴더에 생성, 원본은 그대로 목록에 남음; mycelium unsplit로 되돌리기)
  {${fg}-fg}Shift+O{/} 정렬 순서 전환 — 최신순(기본) → 제목순(A-Z) → 에이전트순
  {${fg}-fg}Shift+T{/} 정렬 방식 직접 선택 — 최신순/오래된순, 제목 A-Z/Z-A

{bold}상세 패널{/}

  {${fg}-fg}↑↓{/}      스크롤
  {${fg}-fg}Enter{/}   이어열기 — "여기서 열기" 또는 "명령어 복사" 선택 (세션 패널의 r은 항상 바로 열기)
  {${fg}-fg}Esc / ←{/}     세션 패널로
  {${fg}-fg}a / e / y / x{/}  세션 패널과 동일

핸드오프로 이어진 세션은 목록에 {${spore}-fg}↩{/}/{${spore}-fg}→{/} 마커, 상세에 이어받음/이어감 링크로 표시됩니다.`;

ko['welcome.body'] = (fg) => `Mycelium은 AI 코딩 에이전트 세션이 흩어지지 않게 관리합니다 —
이 화면 안에서 4단계를 거칩니다:

{${fg}-fg}생성(Capture){/}   Claude Code/Codex/Kiro/OpenCode 세션을 자동으로 가져옵니다
              (켜져 있는 동안 5분마다, 또는 {${fg}-fg}s{/}로 지금 바로).
              이 시점엔 아직 어느 폴더에도 안 들어갑니다.

{${fg}-fg}조직화(Organize){/}  {${fg}-fg}o{/}를 누르면 가져온 세션을 요약하고 내용 기준으로
              폴더에 정리해 제안합니다 — 맞는 것만 골라서 적용하세요.

{${fg}-fg}학습(Learn){/}     {${fg}-fg}a{/}는 세션 하나의 요약·태그를 (다시) 생성, {${fg}-fg}w{/}는 폴더
              전체 세션을 KNOWLEDGE.md 하나로 압축합니다.

{${fg}-fg}재사용(Reuse){/}    {${fg}-fg}n{/}/{${fg}-fg}h{/}는 그 폴더의 KNOWLEDGE.md를 이미 알고 있는 새
              에이전트 세션을 띄우고, {${fg}-fg}r{/}은 기존 세션을 그대로 이어엽니다.

아직 {${fg}-fg}mycelium scan{/}을 안 하셨다면 목록이 비어 있을 텐데,
{${fg}-fg}s{/}를 먼저 눌러보세요. 전체 단축키는 언제든 {${fg}-fg}?{/}. 이 화면은 자동으로
다시 뜨진 않지만, 다시 보고 싶으면 언제든 {${fg}-fg}g{/}를 누르세요.`;

const DICTS = { en, ko };

export function t(key, ...args) {
  const dict = DICTS[locale] || DICTS.en;
  const entry = dict[key] ?? DICTS.en[key] ?? key;
  return typeof entry === 'function' ? entry(...args) : entry;
}
