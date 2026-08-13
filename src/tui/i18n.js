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
  'sessions.unfiledHint': (n) => `${n} session(s) captured, no folders yet — press o to sort them by content`,
  // Large-backlog counterpart to unfiledHint above — index.js promotes to
  // this modal instead of the toast once the unfiled count clears
  // FIRST_SCAN_MODAL_THRESHOLD, since a real first scan can mean minutes
  // of classification, not an instant.
  'sessions.firstScanModalLabel': ' First scan done — nothing organized yet (Enter/Esc to dismiss) ',
  'sessions.firstScanBody': (n, fg) =>
    `{bold}${n} sessions captured, nothing organized yet.{/}\n\n` +
    `Press {${fg}-fg}o{/} to sort them all by content — Mycelium reads and classifies each one, which takes real time for a backlog this size.\n\n` +
    `Feel free to switch away and do something else in the meantime — it keeps running. Come back and review the suggestions whenever you're ready.`,
  'detail.noSummary': '(no summary yet — press a in the session to summarize/tag)',
  'detail.lastActive': 'last active',
  'detail.firstRequest': 'First request:',
  'detail.summary': 'Summary',
  'detail.decisions': 'Decisions',
  'detail.todos': 'Action Items',
  'detail.continuationOf': (label) => `Continues: ${label}`,
  'detail.continuedTo': (label) => `Continued by: ${label}`,
  'detail.mergedFrom': (n, labels) => `Merged from ${n}: ${labels}`,
  'detail.splitFrom': (label) => `Split from: ${label}`,
  'detail.superseded': (labels) => `Superseded by: ${labels}`,
  'detail.splitInto': (n, labels) => `Split into ${n}: ${labels}`,

  // sessions.js — status bar. Used to spell out the full 4-stage/11-key
  // breakdown on every single screen (Capture·s → Organize·m/t/o →
  // Learn·a/w → Reuse·n/h/r/i) — a permanent status bar is the wrong place
  // to teach the whole model every render; that detail now lives in the ?
  // modal (help.text's new leading section) instead. The footer now names
  // the day-to-day loop's four stages by their canonical names (matching
  // README.md/AGENTS.md's own Capture → Organize → Learn → Reuse), each
  // paired with its one flywheel key — s (capture/scan), o (organize),
  // k (learn — knowledge review), n (reuse — new session). Digest (`d`) is
  // real and still listed in its own Global line below, it's just not one
  // of these four canonical stages, so it isn't part of this loop.
  'lifecycle.bar': (fg) =>
    `Capture·{${fg}-fg}s{/} → Organize·{${fg}-fg}o{/} → Learn·{${fg}-fg}k{/} → Reuse·{${fg}-fg}n{/}`,
  'status.helpFallback': '? all shortcuts   q quit',

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

  // First-run tutorial (tutorial.js) — mock sessions, real o/w LLM calls.
  // Body strings are (fg) => `...` functions (same style as help.text/
  // welcome.body) so the key they're waiting for can be highlighted inline.
  'tutorial.promptTitle': 'First time here! Want a quick interactive tour?',
  'tutorial.promptYes': 'Start the tutorial',
  'tutorial.promptNo': 'Skip, just show me around',
  'tutorial.personaPromptTitle': 'Whose work should the tour follow?',
  'tutorial.exitHint': 'q: exit tutorial',
  // "Step N/Total" itself — see tutorial.js's render(), computed from
  // STEPS.length/index rather than baked into each stepNTitle below, so
  // every stepNTitle now holds only its subtitle (or '' for steps without
  // one) and inserting/removing a step never means renumbering anything.
  'tutorial.stepCounter': (n, total) => `Step ${n}/${total}`,
  'tutorial.introTitle': '',
  'tutorial.introBody': (fg) =>
    `{bold}Welcome to Mycelium{/} — a Context Lifecycle platform for AI collaboration: {${fg}-fg}Capture → Organize → Learn → Reuse{/}. Every session from Claude Code, Codex, or Kiro gets captured automatically; this tour shows you the loop that keeps them useful instead of lost. Three panels — Folders → Sessions → Detail — walked with {${fg}-fg}→{/}/{${fg}-fg}←{/}. Press {${fg}-fg}Enter{/} now to step into your first folder and begin.`,
  'tutorial.step2Title': ' — Organize',
  'tutorial.step2Body': (fg, count) => `${count} fresh, unfiled sessions are sitting below. Press {${fg}-fg}o{/} to have Mycelium read them and suggest folders.`,
  'tutorial.step3Title': '',
  'tutorial.step3Body': (fg) => `Review the suggested folders, then press {${fg}-fg}Enter{/} to apply them.`,
  'tutorial.step4Title': '',
  'tutorial.step4Body': (fg, count, folder) =>
    `Folders were created automatically and your sessions are sorted — several landed together in \`${folder}\`. Press {${fg}-fg}←{/} to get back to the Folders panel, then {${fg}-fg}↓{/} to find it and {${fg}-fg}Enter{/}/→ to open it.`,
  'tutorial.step5Title': ' — Learn',
  'tutorial.step5Body': (fg, count, folder) => `With \`${folder}\` open, press {${fg}-fg}w{/} — Mycelium distills everything in it into one KNOWLEDGE.md.`,
  'tutorial.step6Title': '',
  'tutorial.step6Body': (fg) => `Review the knowledge draft, then press {${fg}-fg}Enter{/} to save it. Next: see exactly what a new session here would inherit from it.`,
  'tutorial.step7Title': ' — Reuse',
  'tutorial.step7Body': (fg) => `Press {${fg}-fg}c{/} to see the context a new session in this folder would inherit.`,
  'tutorial.step8Title': '',
  'tutorial.step8Body': (fg) =>
    `This is exactly what gets injected into AGENTS.md automatically whenever you start a session here with {${fg}-fg}n{/} or {${fg}-fg}h{/} — or press {${fg}-fg}i{/} to inject it into a project manually, right now. Press {${fg}-fg}c{/} or {${fg}-fg}Esc{/} to close.`,
  'tutorial.step9Title': ' — Knowledge Review',
  'tutorial.step9Body': (fg) =>
    `That was one folder, by hand. Every folder's knowledge can also be refreshed in one place — press {${fg}-fg}k{/} to check for (or compute) today's knowledge updates, unrelated to Digest.`,
  'tutorial.step10Title': '',
  'tutorial.step10Body': (fg) =>
    `Everything's pre-checked. Press {${fg}-fg}Enter{/} to approve — this writes KNOWLEDGE.md AND injects straight into AGENTS.md wherever each folder's sessions have run, all in one step.`,
  'tutorial.step11Title': ' — Merge',
  'tutorial.step11Body': (fg) =>
    `These sessions are actually one story. Select them with {${fg}-fg}Space{/}, then press {${fg}-fg}Shift+M{/} to merge them into one continuous record.`,
  'tutorial.step12Title': '',
  'tutorial.step12Body': (fg) => `Type a title (or leave it blank for a default), then press {${fg}-fg}Enter{/}.`,
  'tutorial.step13Title': ' — Split',
  'tutorial.step13Body': (fg, count, folder) =>
    `Fully reversible, the other direction too. The merged session stayed right here in \`${folder}\` — with it selected, press {${fg}-fg}Shift+S{/} for topic-boundary suggestions.`,
  'tutorial.step14Title': '',
  'tutorial.step14Body': (fg) => `Press {${fg}-fg}*{/} to select all the proposed ranges, then {${fg}-fg}Enter{/} to apply.`,
  'tutorial.step15Title': '',
  'tutorial.step15Body': (fg) =>
    `Press {${fg}-fg}/{/} and search for a keyword you remember from these sessions, then press {${fg}-fg}v{/} to check the calendar and find the date they're on. Press {${fg}-fg}Enter{/} to continue.`,
  'tutorial.step16Title': ' — Complete!',
  'tutorial.step16Body': (fg) =>
    `That's the full lifecycle. Day to day, it's a simple loop — the {bold}Context Flywheel{/}: {${fg}-fg}s{/} capture → {${fg}-fg}o{/} organize → {${fg}-fg}k{/} learn → {${fg}-fg}n{/} start the next session with everything it needs. Most of that already happens by itself in the background — Mycelium keeps capturing, organizing, and refreshing what it's learned on its own; pressing these keys is mostly just reviewing and confirming what's already waiting for you, not starting the work from scratch. Press {${fg}-fg}q{/} when you're done — the mock sessions get cleaned up and you're back to your own, existing data.`,
  // Interim text shown while a real handler is in flight (o/w/k/Shift+S's
  // LLM calls are mocked during the tutorial — see tutorial-mock-llm.js —
  // so these resolve almost instantly, but the narrator still has to wait
  // for the actual modal to open/close (see tutorial.js's isModalOpen
  // polling) rather than trusting the raw keypress alone).
  'tutorial.waitingOrganize': 'Reading sessions and drafting folder suggestions…',
  'tutorial.waitingApply': 'Applying…',
  'tutorial.waitingKnowledge': "Distilling this folder's sessions into a knowledge draft…",
  'tutorial.waitingSave': 'Saving…',
  'tutorial.waitingContext': 'Assembling inherited context…',
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
  'editor.notFound': 'Session not found',
  'editor.saved': 'Title saved (Mycelium only — original log unchanged)',
  'editor.saveFailed': (err) => `Save failed: ${err}`,

  // launch.js
  'launch.noAgents': 'No agent CLI installed (claude/codex/kiro-cli)',
  'launch.selectAgent': 'Choose agent',
  'launch.chooseAction': 'Start session',
  'launch.selectAgentFallback': "Can't resume (merged/split session) — choose agent; this will be replaced by the new session",
  'launch.dirNotFound': "Directory doesn't exist",
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
  'sessions.unfiledHint': (n) => `${n}개 세션을 가져왔지만 아직 폴더가 없습니다 — o를 눌러 내용 기준으로 정리해보세요`,
  'sessions.firstScanModalLabel': ' 첫 스캔 완료 — 아직 정리되지 않음 (Enter/Esc로 닫기) ',
  'sessions.firstScanBody': (n, fg) =>
    `{bold}${n}개 세션을 가져왔지만 아직 정리되지 않았습니다.{/}\n\n` +
    `{${fg}-fg}o{/}를 눌러 내용 기준으로 전부 정리해보세요 — Mycelium이 각 세션을 읽고 분류하는데, 세션이 많으면 실제로 시간이 걸립니다.\n\n` +
    `그 동안 다른 작업을 하다 와도 괜찮습니다 — 계속 진행되고 있으니, 준비되면 돌아와서 제안 내용을 검토하세요.`,
  'detail.noSummary': '(요약 없음 — 세션에서 a를 눌러 요약·태깅 생성)',
  'detail.lastActive': '최근 활동',
  'detail.firstRequest': '첫 요청:',
  'detail.summary': '요약',
  'detail.decisions': '결정',
  'detail.todos': '실행 항목',
  'detail.continuationOf': (label) => `이어받음: ${label}`,
  'detail.continuedTo': (label) => `이어감: ${label}`,
  'detail.mergedFrom': (n, labels) => `${n}개 병합됨: ${labels}`,
  'detail.splitFrom': (label) => `분할됨 — 원본: ${label}`,
  'detail.superseded': (labels) => `대체됨: ${labels}`,
  'detail.splitInto': (n, labels) => `${n}개로 분할됨: ${labels}`,

  'lifecycle.bar': (fg) =>
    `캡처·{${fg}-fg}s{/} → 정리·{${fg}-fg}o{/} → 학습·{${fg}-fg}k{/} → 재사용·{${fg}-fg}n{/}`,

  'status.helpFallback': '? 전체 단축키   q 종료',

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

  'tutorial.promptTitle': '처음 오셨네요! 짧은 인터랙티브 튜토리얼 보시겠어요?',
  'tutorial.promptYes': '튜토리얼 시작하기',
  'tutorial.promptNo': '건너뛰고 바로 시작하기',
  'tutorial.personaPromptTitle': '누구의 작업을 따라가 볼까요?',
  'tutorial.exitHint': 'q: 튜토리얼 종료',
  'tutorial.stepCounter': (n, total) => `${n}/${total}단계`,
  'tutorial.introTitle': '',
  'tutorial.introBody': (fg) =>
    `{bold}Mycelium에 오신 걸 환영합니다{/} — AI 협업을 위한 Context Lifecycle 플랫폼입니다: {${fg}-fg}Capture → Organize → Learn → Reuse{/}. Claude Code, Codex, Kiro의 모든 세션이 자동으로 캡처됩니다 — 이 투어는 그 세션들을 잃어버리지 않고 계속 쓸모 있게 만드는 흐름을 보여줍니다. 세 개의 패널 — 폴더 → 세션 → 상세 — 은 {${fg}-fg}→{/}/{${fg}-fg}←{/}로 이동합니다. 지금 {${fg}-fg}Enter{/}를 눌러 첫 폴더로 들어가 시작하세요.`,
  'tutorial.step2Title': ' — 조직화',
  'tutorial.step2Body': (fg, count) => `아직 정리 안 된 세션 ${count}개가 아래에 있습니다. {${fg}-fg}o{/}를 눌러 Mycelium이 내용을 읽고 폴더를 제안하게 해보세요.`,
  'tutorial.step3Title': '',
  'tutorial.step3Body': (fg) => `제안된 폴더를 확인하고 {${fg}-fg}Enter{/}로 적용해보세요.`,
  'tutorial.step4Title': '',
  'tutorial.step4Body': (fg, count, folder) =>
    `폴더가 자동으로 생성되고 세션들이 정리됐습니다 — 관련 세션 여럿이 \`${folder}\`로 함께 모였습니다. {${fg}-fg}←{/}로 Folders 패널로 돌아간 뒤 {${fg}-fg}↓{/}로 찾고 {${fg}-fg}Enter{/}/→로 열어보세요.`,
  'tutorial.step5Title': ' — 학습',
  'tutorial.step5Body': (fg, count, folder) => `\`${folder}\`를 연 상태에서 {${fg}-fg}w{/}를 눌러보세요 — 그 폴더의 모든 세션을 하나의 KNOWLEDGE.md로 압축합니다.`,
  'tutorial.step6Title': '',
  'tutorial.step6Body': (fg) => `지식 초안을 확인하고 {${fg}-fg}Enter{/}로 저장하세요. 다음: 새 세션이 여기서 무엇을 물려받는지 직접 확인해봅니다.`,
  'tutorial.step7Title': ' — 재사용',
  'tutorial.step7Body': (fg) => `{${fg}-fg}c{/}를 눌러 이 폴더의 새 세션이 물려받을 컨텍스트를 확인해보세요.`,
  'tutorial.step8Title': '',
  'tutorial.step8Body': (fg) =>
    `{${fg}-fg}n{/} 또는 {${fg}-fg}h{/}로 이 폴더에서 세션을 시작할 때마다 이 내용이 AGENTS.md에 자동으로 주입됩니다 — 또는 {${fg}-fg}i{/}로 지금 바로 프로젝트에 직접 주입할 수도 있습니다. {${fg}-fg}c{/} 또는 {${fg}-fg}Esc{/}로 닫으세요.`,
  'tutorial.step9Title': ' — 지식 검토',
  'tutorial.step9Body': (fg) =>
    `방금은 폴더 하나를 손으로 했죠. 모든 폴더의 지식을 한 곳에서 한 번에 갱신할 수도 있습니다 — {${fg}-fg}k{/}를 눌러 오늘의 지식 업데이트를 확인(또는 계산)해보세요. Digest와는 무관한 별개 기능입니다.`,
  'tutorial.step10Title': '',
  'tutorial.step10Body': (fg) =>
    `전부 기본으로 체크되어 있습니다. {${fg}-fg}Enter{/}를 눌러 승인하세요 — 이 한 번으로 각 폴더의 KNOWLEDGE.md를 갱신하고, 그 폴더의 세션들이 실행됐던 모든 곳의 AGENTS.md에도 바로 주입됩니다.`,
  'tutorial.step11Title': ' — 병합',
  'tutorial.step11Body': (fg) =>
    `이 세션들은 사실 하나의 이야기입니다. {${fg}-fg}Space{/}로 선택한 뒤 {${fg}-fg}Shift+M{/}으로 하나의 연속된 기록으로 병합해보세요.`,
  'tutorial.step12Title': '',
  'tutorial.step12Body': (fg) => `제목을 입력하거나(비워두면 기본값) {${fg}-fg}Enter{/}를 누르세요.`,
  'tutorial.step13Title': ' — 분할',
  'tutorial.step13Body': (fg, count, folder) =>
    `반대 방향도 완전히 되돌릴 수 있습니다. 병합된 세션은 그대로 \`${folder}\`에 남아 있습니다 — 선택된 상태에서 {${fg}-fg}Shift+S{/}로 주제 경계 제안을 받아보세요.`,
  'tutorial.step14Title': '',
  'tutorial.step14Body': (fg) => `{${fg}-fg}*{/}로 제안된 구간을 모두 선택한 뒤 {${fg}-fg}Enter{/}로 적용하세요.`,
  'tutorial.step15Title': '',
  'tutorial.step15Body': (fg) =>
    `{${fg}-fg}/{/}를 눌러 방금 본 세션들에서 기억나는 키워드로 검색해보고, {${fg}-fg}v{/}를 눌러 캘린더에서 해당 세션이 있는 날짜를 확인해보세요. {${fg}-fg}Enter{/}로 계속하세요.`,
  'tutorial.step16Title': ' — 완료!',
  'tutorial.step16Body': (fg) =>
    `전체 라이프사이클을 다 보셨습니다. 일상적으로는 단순한 반복입니다 — {bold}Context Flywheel{/}: {${fg}-fg}s{/} 캡처 → {${fg}-fg}o{/} 정리 → {${fg}-fg}k{/} 학습 → {${fg}-fg}n{/} 필요한 모든 게 준비된 채로 다음 세션 시작. 대부분은 이미 백그라운드에서 저절로 돌아갑니다 — Mycelium이 알아서 캡처하고 정리하고 배운 것을 갱신해둡니다. 이 키들을 누르는 건 대부분 처음부터 뭔가 시작시키는 게 아니라 이미 준비된 걸 검토/확인하는 것에 가깝습니다. 다 보셨으면 {${fg}-fg}q{/}를 누르세요 — 데모 세션이 정리되고 원래(기존) 데이터로 돌아갑니다.`,
  'tutorial.waitingOrganize': '세션을 읽고 폴더를 제안하는 중…',
  'tutorial.waitingApply': '적용하는 중…',
  'tutorial.waitingKnowledge': '이 폴더의 세션들을 지식 초안으로 압축하는 중…',
  'tutorial.waitingSave': '저장하는 중…',
  'tutorial.waitingContext': '상속받을 컨텍스트를 조합하는 중…',
  'tutorial.waitingKnowledgeReview': '오늘 활동이 있었던 폴더를 확인해 지식을 갱신하는 중…',
  'tutorial.waitingMerge': 'Shift+M을 기다리는 중 — 먼저 Space로 세션 두 개를 선택했는지 확인하세요.',
  'tutorial.waitingSplit': '병합된 세션의 주제 경계를 분석하는 중…',

  'picker.newLabel': '{gray-fg}New (미분류){/}',
  'picker.folderLabel': ' 폴더 선택 (Enter, Esc 취소) ',
  'picker.createNew': '+ 새 폴더 입력…',
  'picker.newPathPrompt': '새 폴더 경로 (예: 회사/플랫폼/인증)',
  'picker.tagEditPrompt': (shown) => `태그 편집 — 현재: ${shown}\n+추가 -삭제 (예: +긴급 -오분류)`,

  'editor.titlePrompt': '제목 수정',
  'editor.notFound': '세션을 찾을 수 없습니다',
  'editor.saved': '제목 저장됨 (Mycelium 전용, 원본 로그는 변경 없음)',
  'editor.saveFailed': (err) => `저장 실패: ${err}`,

  'launch.noAgents': '설치된 에이전트(claude/codex/kiro-cli)가 없습니다',
  'launch.selectAgent': '에이전트 선택',
  'launch.chooseAction': '세션 시작',
  'launch.selectAgentFallback': '이어열기 불가(병합/분할된 세션) — 에이전트 선택, 이 세션은 새 세션으로 대체됩니다',
  'launch.dirNotFound': '디렉토리가 존재하지 않습니다',
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

  'merge.needsTwo': '먼저 세션을 2개 이상 선택하세요 (Space)',
  'merge.titlePrompt': '병합된 세션의 제목 (선택 사항)',
  'merge.summarizing': '병합된 세션 요약 중…',
  'merge.done': (n, id) => `${n}개 세션 병합됨 — \`mycelium unmerge ${id}\`로 되돌리기`,
  'merge.reverted': (n) => `병합 취소됨 — 원본 세션 ${n}개 복원`,

  'split.suggesting': '주제 경계 분석 중…',
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
Day to day, it's a simple loop: {${fg}-fg}s{/} capture → {${fg}-fg}o{/} organize → {${fg}-fg}k{/} learn → {${fg}-fg}n{/} start the next session with everything it needs. Most of that already runs by itself in the background (capture every 5 min, organize suggestions queued, knowledge updates prepared) — pressing these keys is mostly reviewing/confirming what's already waiting, not starting from scratch. Everything below is the full detail behind that loop.

{bold}Global{/}
  {${fg}-fg}s{/}       Scan (mycelium scan, no CLI needed — captures new/changed sessions, no auto-filing; use \`o\` or \`mycelium organize\` to file them)
  {${fg}-fg}o{/}       Smart organize — scoped to wherever you're browsing (Root = unfiled only, a folder = itself + subfolders); suggests folders by content, may propose new folders too — all pre-checked, Enter applies everything, Space to uncheck any
  {${fg}-fg}k{/}       Knowledge review — reviews/refreshes KNOWLEDGE.md across every active folder at once and injects AGENTS.md on approval; reuses whatever the daemon already queued overnight, or computes fresh on the spot. Unrelated to Digest (d)
  {${fg}-fg}/{/}       Full-text search
  {${fg}-fg}v{/}       Toggle to the Calendar tab — full screen, browse by day (press v again to return)
  {${fg}-fg}d{/}       View digests (open, then n/w to generate today/this week)
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
  {${fg}-fg}y{/}       Copy to clipboard
  {${fg}-fg}r{/}       Resume (reopen in the original agent, right here — merged/split sessions fall back to handoff instead, which replaces them with the real session it produces)
  {${fg}-fg}h{/}       Handoff (start a new session on a different agent)
  {${fg}-fg}n{/}       Launch a new agent session with this folder's context — after picking an agent/directory, asks "open here" or "copy command" (paste into a separate terminal tab to run several sessions in parallel)
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

{bold}Detail panel{/}
  {${fg}-fg}↑↓{/}      Scroll
  {${fg}-fg}Enter{/}   Resume — choose "open here" or "copy command" (r in the sessions panel always opens here)
  {${fg}-fg}Esc / ←{/}     Back to sessions
  {${fg}-fg}a / e / y / x{/}  Same as sessions panel

Sessions linked by handoff show {${spore}-fg}↩{/}/{${spore}-fg}→{/} markers in the list and continuation links in detail.`;

en['welcome.body'] = (fg) => `Mycelium keeps AI coding-agent sessions from getting lost —
each one moves through 4 stages, all inside this screen:

{${fg}-fg}Capture{/}   Sessions from Claude Code / Codex / Kiro get pulled in automatically
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
일상적으로는 단순한 반복입니다: {${fg}-fg}s{/} 캡처 → {${fg}-fg}o{/} 정리 → {${fg}-fg}k{/} 학습 → {${fg}-fg}n{/} 필요한 모든 게 준비된 채로 다음 세션 시작. 대부분은 이미 백그라운드에서 저절로 돌아갑니다(5분마다 캡처, 정리 제안 대기, 지식 업데이트 준비) — 이 키들을 누르는 건 대부분 처음부터 시작시키는 게 아니라 이미 준비된 걸 검토/확인하는 것에 가깝습니다. 아래는 그 흐름 뒤의 전체 상세입니다.

{bold}전역{/}
  {${fg}-fg}s{/}       스캔 (mycelium scan, CLI 없이 — 새/변경된 세션 캡처만, 자동 배치는 안 함; 배치는 o 또는 mycelium organize로)
  {${fg}-fg}o{/}       스마트 정리 — 지금 보고 있는 범위로 한정(Root=미분류만, 폴더 안=그 폴더+하위만), 새 폴더 제안도 가능 — 전부 체크된 채로 떠서 Enter만으로 전체 적용, 잘못된 것만 Space로 해제
  {${fg}-fg}k{/}       지식 검토 — 활동이 있었던 모든 폴더의 KNOWLEDGE.md를 한 번에 검토/갱신하고 승인 시 AGENTS.md에 주입. 데몬이 밤새 미리 계산해둔 게 있으면 재사용하고, 없으면 그 자리에서 계산. Digest(d)와는 무관
  {${fg}-fg}/{/}       전문 검색
  {${fg}-fg}v{/}       캘린더 탭으로 전환 — 전체 화면, 날짜별로 탐색 (다시 v를 누르면 세션으로 복귀)
  {${fg}-fg}d{/}       다이제스트 보기 (열어서 n/w로 오늘/이번주 생성)
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
  {${fg}-fg}y{/}       클립보드로 복사
  {${fg}-fg}r{/}       이어열기 (원래 에이전트로, 바로 여기서 — 병합/분할 세션은 핸드오프로 대체되고, 그렇게 생긴 실제 세션이 원래 자리를 대신함)
  {${fg}-fg}h{/}       핸드오프 (다른 에이전트로 새 세션 시작)
  {${fg}-fg}n{/}       이 폴더 컨텍스트로 새 에이전트 세션 — 에이전트/디렉터리 선택 후 "여기서 열기" 또는 "명령어 복사" 선택 (복사하면 다른 터미널 탭에 붙여넣어 여러 세션을 동시에 실행 가능)
  {${fg}-fg}m{/} / {${fg}-fg}t{/}   폴더 이동 / 태그 편집
  {${fg}-fg}x{/}       세션 삭제 (Mycelium 저장소에서만, 원본 로그 유지)
  {${fg}-fg}w{/}       폴더 지식 추출 — 미리보기 후 확인
  {${fg}-fg}c{/}       상속 컨텍스트 보기
  {${fg}-fg}i{/}       AGENTS.md에 주입 — 미리보기 후 확인 (n/h는 자동으로 함; Mycelium 밖에서 연 세션 새로고침용)
  {${fg}-fg}Space{/}   다중 선택
  {${fg}-fg}*{/}       현재 목록 전체 선택 (다시 누르면 전체 해제)
  {${fg}-fg}Shift+M{/} 선택한 세션 2개 이상 병합 (git처럼 — 원본은 안 지워지고 숨겨질 뿐, mycelium unmerge로 되돌리기)
  {${fg}-fg}Shift+S{/} 분할 (LLM이 주제 경계 제안, 검토 후 적용 — 조각은 원본과 같은 폴더에 생성, 원본은 그대로 목록에 남음; mycelium unsplit로 되돌리기)
  {${fg}-fg}Shift+O{/} 정렬 순서 전환 — 최신순(기본) → 제목순(A-Z) → 에이전트순

{bold}상세 패널{/}
  {${fg}-fg}↑↓{/}      스크롤
  {${fg}-fg}Enter{/}   이어열기 — "여기서 열기" 또는 "명령어 복사" 선택 (세션 패널의 r은 항상 바로 열기)
  {${fg}-fg}Esc / ←{/}     세션 패널로
  {${fg}-fg}a / e / y / x{/}  세션 패널과 동일

핸드오프로 이어진 세션은 목록에 {${spore}-fg}↩{/}/{${spore}-fg}→{/} 마커, 상세에 이어받음/이어감 링크로 표시됩니다.`;

ko['welcome.body'] = (fg) => `Mycelium은 AI 코딩 에이전트 세션이 흩어지지 않게 관리합니다 —
이 화면 안에서 4단계를 거칩니다:

{${fg}-fg}생성(Capture){/}   Claude Code/Codex/Kiro 세션을 자동으로 가져옵니다
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
