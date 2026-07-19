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
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.none': '(none)',
  'common.noContent': '(no content)',
  'common.searchPrompt': 'Search',
  'folders.root': 'Root',
  'sessions.newBadge': 'New',

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
  'folders.deleteConfirmYes': (rootLabel) => `Delete (sessions become unfiled, shown as New in ${rootLabel})`,
  'folders.deleted': (moved) => `Deleted (${moved} session(s) → unfiled)`,
  'folders.selectFirst': 'Select a folder first',

  // sessions.js — session list / detail
  'sessions.empty': 'No sessions',
  'sessions.movedTo': (n, folder) => `${n} session(s) → ${folder}`,
  'sessions.tagsUpdated': (n) => `${n} session(s) tags updated`,
  'sessions.deleteConfirmTitle': (n) => `Delete ${n} session(s)? (Mycelium record only, original log kept)`,
  'sessions.deleted': (n) => `${n} session(s) deleted`,
  'sessions.summarizing': (i, n) => `Summarizing… (${i}/${n})`,
  'sessions.summarizeDone': (done, failed, lastError) =>
    `Summarized: ${done}${failed ? ` (failed ${failed}${lastError ? `: ${lastError}` : ''})` : ''}`,
  'sessions.copied': 'Session content copied to clipboard',
  'sessions.copyFailed': 'No clipboard tool found (pbcopy etc.)',
  'detail.noSummary': '(no summary yet — press a in the session to summarize/tag)',
  'detail.firstRequest': 'First request:',
  'detail.tags': 'Tags',
  'detail.decisions': 'Decisions',
  'detail.todos': 'To-dos',
  'detail.continuationOf': (label) => `↩ continues: ${label}`,
  'detail.continuedTo': (label) => `→ continued by: ${label}`,

  // sessions.js — status bar
  'status.helpFallback': '? all shortcuts   q quit',
  'status.folders': '{bold}Folders{/}  ·  Enter open  ·  ? all shortcuts  ·  q quit',
  'status.sessions': '{bold}Sessions{/}  ·  Enter detail  ·  Esc to folders  ·  ? all shortcuts  ·  q quit',
  'status.detail': '{bold}Detail{/}  ·  ↑↓ scroll  ·  Enter resume  ·  Esc to sessions  ·  ? all shortcuts  ·  q quit',

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

  // pickers.js
  'picker.newLabel': '{gray-fg}New (unfiled){/}',
  'picker.folderLabel': ' Choose folder (Enter, Esc cancel) ',
  'picker.createNew': '+ Type a new one…',
  'picker.newPathPrompt': 'New folder path (e.g. company/platform/auth)',
  'picker.tagEditPrompt': (shown) => `Edit tags — current: ${shown}\n+add -remove (e.g. +urgent -miscategorized)`,

  // editor.js
  'editor.titleMarker': 'Title:',
  'editor.notFound': 'Session not found',
  'editor.prepFailed': (msg) => `Couldn't prepare edit: ${msg}`,
  'editor.readFailed': (msg) => `Couldn't read edit result: ${msg}`,
  'editor.saved': 'Title/summary saved (Mycelium only — original log unchanged)',
  'editor.saveFailed': (err) => `Save failed: ${err}`,

  // launch.js
  'launch.noAgents': 'No agent CLI installed (claude/codex)',
  'launch.selectAgent': 'Choose agent',
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

  'help.text': null, // filled in below (large block)
};

const ko = {
  'app.needsTty': 'Mycelium TUI는 실제 터미널(TTY)에서 실행하세요.',
  'common.cancel': '취소',
  'common.delete': '삭제',
  'common.none': '(없음)',
  'common.noContent': '(내용 없음)',
  'common.searchPrompt': '검색',
  'folders.root': 'Root',
  'sessions.newBadge': 'New',

  'folders.newPrompt': (parent) => `새 폴더 이름${parent ? ` (${parent} 아래)` : ' (루트)'}`,
  'folders.created': (path) => `폴더 생성: ${path}`,
  'folders.cannotRenameRoot': 'Root는 이름을 바꿀 수 없습니다',
  'folders.renamePrompt': (f) => `이름 변경: ${f}`,
  'folders.renamed': (to) => `이름 변경: ${to}`,
  'folders.cannotMoveRoot': 'Root는 옮길 수 없습니다',
  'folders.movedTo': (to) => `이동: ${to}`,
  'folders.cannotDeleteRoot': 'Root는 삭제할 수 없습니다',
  'folders.deleteConfirmTitle': (f) => `"${f}" 삭제?`,
  'folders.deleteConfirmYes': (rootLabel) => `삭제 (세션은 미분류로, ${rootLabel}에서 New로 표시)`,
  'folders.deleted': (moved) => `삭제됨 (세션 ${moved}개 → 미분류)`,
  'folders.selectFirst': '폴더를 먼저 선택하세요',

  'sessions.empty': '세션 없음',
  'sessions.movedTo': (n, folder) => `${n}개 세션 → ${folder}`,
  'sessions.tagsUpdated': (n) => `${n}개 세션 태그 갱신`,
  'sessions.deleteConfirmTitle': (n) => `${n}개 세션 삭제? (Mycelium에서만 삭제, 원본 로그는 유지)`,
  'sessions.deleted': (n) => `${n}개 세션 삭제됨`,
  'sessions.summarizing': (i, n) => `요약·태깅 생성 중… (${i}/${n})`,
  'sessions.summarizeDone': (done, failed, lastError) =>
    `요약·태깅 완료: ${done}개${failed ? ` (실패 ${failed}개${lastError ? `: ${lastError}` : ''})` : ''}`,
  'sessions.copied': '세션 내용을 클립보드에 복사함',
  'sessions.copyFailed': '복사 도구(pbcopy 등)를 찾지 못함',
  'detail.noSummary': '(요약 없음 — 세션에서 a를 눌러 요약·태깅 생성)',
  'detail.firstRequest': '첫 요청:',
  'detail.tags': '태그',
  'detail.decisions': '결정',
  'detail.todos': '할일',
  'detail.continuationOf': (label) => `↩ 이어받음: ${label}`,
  'detail.continuedTo': (label) => `→ 이어감: ${label}`,

  'status.helpFallback': '? 전체 단축키   q 종료',
  'status.folders': '{bold}폴더{/}  ·  Enter 열기  ·  ? 전체 단축키  ·  q 종료',
  'status.sessions': '{bold}세션{/}  ·  Enter 상세  ·  Esc 폴더로  ·  ? 전체 단축키  ·  q 종료',
  'status.detail': '{bold}상세{/}  ·  ↑↓ 스크롤  ·  Enter 이어열기  ·  Esc 세션으로  ·  ? 전체 단축키  ·  q 종료',

  'scan.inProgress': '스캔 중…',
  'scan.failed': (msg) => `스캔 실패: ${msg}`,
  'scan.done': (imported, scanned, skipped, failed) =>
    `스캔 +${imported} (총 ${scanned}, 건너뜀 ${skipped}${failed ? `, 실패 ${failed}` : ''})`,

  'knowledge.generating': '지식 초안 생성 중…',
  'knowledge.previewTitle': (folder) => `KNOWLEDGE.md 미리보기 · ${folder}`,
  'knowledge.cancelled': '취소됨 — KNOWLEDGE.md 변경 없음',
  'knowledge.saved': (folder) => `KNOWLEDGE.md 저장: ${folder}`,
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

  'picker.newLabel': '{gray-fg}New (미분류){/}',
  'picker.folderLabel': ' 폴더 선택 (Enter, Esc 취소) ',
  'picker.createNew': '+ 새 폴더 입력…',
  'picker.newPathPrompt': '새 폴더 경로 (예: 회사/플랫폼/인증)',
  'picker.tagEditPrompt': (shown) => `태그 편집 — 현재: ${shown}\n+추가 -삭제 (예: +긴급 -오분류)`,

  'editor.titleMarker': '제목:',
  'editor.notFound': '세션을 찾을 수 없습니다',
  'editor.prepFailed': (msg) => `편집 준비 실패: ${msg}`,
  'editor.readFailed': (msg) => `편집 결과 읽기 실패: ${msg}`,
  'editor.saved': '제목/요약 저장됨 (Mycelium 전용, 원본 로그는 변경 없음)',
  'editor.saveFailed': (err) => `저장 실패: ${err}`,

  'launch.noAgents': '설치된 에이전트(claude/codex)가 없습니다',
  'launch.selectAgent': '에이전트 선택',
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

  'help.text': null,
};

// The full ? help modal is one cohesive block per locale rather than composed
// from dozens of sub-keys — it's read as a single reference sheet, and
// splitting it further would add ceremony without adding maintainability.
en['help.text'] = (fg, spore) => `{bold}Global{/}
  {${fg}-fg}s{/}       Scan (mycelium scan, no CLI needed — auto-file is still CLI \`mycelium organize\`)
  {${fg}-fg}/{/}       Full-text search
  {${fg}-fg}d{/}       View digests (open, then n/w to generate today/this week)
  {${fg}-fg}?{/}       This help
  {${fg}-fg}q{/}       Quit

{bold}Folders panel{/}
  {${fg}-fg}Enter{/}   View this folder's sessions
  {${fg}-fg}a{/}       New (sub)folder
  {${fg}-fg}e{/}       Rename
  {${fg}-fg}m{/}       Move / nest
  {${fg}-fg}x{/}       Delete (sessions become unfiled, shown as New in Root)
  {${fg}-fg}w{/}       Extract folder knowledge (KNOWLEDGE.md) — preview then confirm

{bold}Sessions panel{/}
  {${fg}-fg}Enter{/}   View detail
  {${fg}-fg}Esc{/}     Back to folders
  {${fg}-fg}a{/}       Generate summary + tags (LLM, batches over multi-select)
  {${fg}-fg}e{/}       Hand-edit title/summary ($EDITOR, Mycelium record only)
  {${fg}-fg}y{/}       Copy to clipboard
  {${fg}-fg}r{/}       Resume (reopen in the original agent)
  {${fg}-fg}h{/}       Handoff (start a new session on a different agent)
  {${fg}-fg}n{/}       Launch a new agent session with this folder's context
  {${fg}-fg}m{/} / {${fg}-fg}t{/}   Move to folder / edit tags
  {${fg}-fg}x{/}       Delete session (Mycelium record only, original log kept)
  {${fg}-fg}w{/}       Extract folder knowledge — preview then confirm
  {${fg}-fg}c{/}       View inherited context
  {${fg}-fg}i{/}       Inject into AGENTS.md — preview then confirm
  {${fg}-fg}Space{/}   Multi-select
  {${fg}-fg}*{/}       Select everything currently listed (press again to clear)

{bold}Detail panel{/}
  {${fg}-fg}↑↓{/}      Scroll
  {${fg}-fg}Enter{/}   Resume (r in the sessions panel)
  {${fg}-fg}Esc{/}     Back to sessions
  {${fg}-fg}a / e / y / x{/}  Same as sessions panel

Sessions linked by handoff show {${spore}-fg}↩{/}/{${spore}-fg}→{/} markers in the list and continuation links in detail.`;

ko['help.text'] = (fg, spore) => `{bold}전역{/}
  {${fg}-fg}s{/}       스캔 (mycelium scan, CLI 없이 — 자동배치는 아직 CLI \`mycelium organize\`로)
  {${fg}-fg}/{/}       전문 검색
  {${fg}-fg}d{/}       다이제스트 보기 (열어서 n/w로 오늘/이번주 생성)
  {${fg}-fg}?{/}       이 도움말
  {${fg}-fg}q{/}       종료

{bold}폴더 패널{/}
  {${fg}-fg}Enter{/}   이 폴더의 세션 보기
  {${fg}-fg}a{/}       새 (하위)폴더
  {${fg}-fg}e{/}       이름 변경
  {${fg}-fg}m{/}       이동 / 중첩
  {${fg}-fg}x{/}       삭제 (세션은 미분류로, Root에서 New로 표시)
  {${fg}-fg}w{/}       폴더 지식(KNOWLEDGE.md) 추출 — 미리보기 후 확인

{bold}세션 패널{/}
  {${fg}-fg}Enter{/}   상세 보기
  {${fg}-fg}Esc{/}     폴더 패널로
  {${fg}-fg}a{/}       요약·태그 생성 (LLM, 다중 선택 시 일괄)
  {${fg}-fg}e{/}       제목·요약 직접 편집 ($EDITOR, Mycelium 저장소만)
  {${fg}-fg}y{/}       클립보드로 복사
  {${fg}-fg}r{/}       이어열기 (원래 에이전트로 resume)
  {${fg}-fg}h{/}       핸드오프 (다른 에이전트로 새 세션 시작)
  {${fg}-fg}n{/}       이 폴더 컨텍스트로 새 에이전트 세션
  {${fg}-fg}m{/} / {${fg}-fg}t{/}   폴더 이동 / 태그 편집
  {${fg}-fg}x{/}       세션 삭제 (Mycelium 저장소에서만, 원본 로그 유지)
  {${fg}-fg}w{/}       폴더 지식 추출 — 미리보기 후 확인
  {${fg}-fg}c{/}       상속 컨텍스트 보기
  {${fg}-fg}i{/}       AGENTS.md에 주입 — 미리보기 후 확인
  {${fg}-fg}Space{/}   다중 선택
  {${fg}-fg}*{/}       현재 목록 전체 선택 (다시 누르면 전체 해제)

{bold}상세 패널{/}
  {${fg}-fg}↑↓{/}      스크롤
  {${fg}-fg}Enter{/}   이어열기 (세션 패널의 r)
  {${fg}-fg}Esc{/}     세션 패널로
  {${fg}-fg}a / e / y / x{/}  세션 패널과 동일

핸드오프로 이어진 세션은 목록에 {${spore}-fg}↩{/}/{${spore}-fg}→{/} 마커, 상세에 이어받음/이어감 링크로 표시됩니다.`;

const DICTS = { en, ko };

export function t(key, ...args) {
  const dict = DICTS[locale] || DICTS.en;
  const entry = dict[key] ?? DICTS.en[key] ?? key;
  return typeof entry === 'function' ? entry(...args) : entry;
}
