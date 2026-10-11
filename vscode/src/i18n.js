'use strict';

// Strings for everything the extension renders itself (the webview panel,
// tree groups, status bar). Manifest strings live in package.nls*.json.
const STR = {
  en: {
    today: 'Today', yesterday: 'Yesterday', thisWeek: 'This week', earlier: 'Earlier',
    unfiled: 'New', unfiledTip: 'Not filed into a folder yet',
    hasKnowledge: 'Has KNOWLEDGE.md', untitled: 'Untitled',
    resume: 'Resume', handoff: 'Hand off', copyPrompt: 'Copy handoff prompt', move: 'Move…', tag: 'Tags…', summarize: 'Summarize', copyId: 'Copy ID',
    notResumable: 'Merged or split sessions can’t be resumed — hand off instead',
    backlogNotResumable: 'A backlog item hasn’t run yet — start it from the TUI',
    summary: 'Summary', decisions: 'Decisions', todos: 'To do', files: 'Files changed', lineage: 'Lineage',
    noSummary: 'No summary yet — run auto-tag in the TUI (a) or `mycelium autotag`.',
    continuationOf: 'Continues', continuedTo: 'Continued in', mergedFrom: 'Merged from', splitFrom: 'Split from', splitInto: 'Split into',
    transcript: 'View transcript', turns: 'turns', thisMachine: 'this machine',
    ago: { now: 'just now', m: (n) => `${n}m ago`, h: (n) => `${n}h ago`, d: (n) => `${n}d ago`, w: (n) => `${n}w ago`, mo: (n) => `${n}mo ago` },
    here: 'here', newCount: 'new',
    menuScan: 'Scan for new sessions', menuOrganize: 'Smart organize', menuGuide: 'Open the guide', menuSearch: 'Search sessions', menuNewAgent: 'Start a new agent session', menuOpen: 'Open the Mycelium sidebar',
    dropTarget: 'Move to this folder',
    unfiledN: (n) => `${n} unfiled`, waitingN: (n) => `${n} waiting`,
    actions: {
      scan: { label: 'Scan for new sessions', stage: 'Capture', tip: 'Pull sessions from Claude Code, Codex, Kiro and OpenCode into Mycelium. New ones appear under New in Folders.' },
      summarize: { label: 'Summarize sessions', stage: 'Learn · AI', tip: 'Give sessions a title, tags, summary, decisions and to-dos (25 at a time, using your own claude/codex login).' },
      organize: { label: 'Smart organize', stage: 'Organize · AI', tip: 'Suggest a folder for each unfiled session; you tick the ones you agree with.' },
      knowledge: { label: 'Extract folder knowledge', stage: 'Learn · AI', tip: 'Write what a folder’s sessions decided into its KNOWLEDGE.md. You review a diff before it is saved.' },
      search: { label: 'Search sessions', stage: 'Find', tip: 'Full-text search across every session; open a result, resume it or hand it off.' },
      newAgent: { label: 'Start a new agent session', stage: 'Reuse', tip: 'Start Claude, Codex… in a folder, optionally with that folder’s knowledge put into AGENTS.md first.' },
      review: { label: 'Review knowledge updates', stage: 'Learn', tip: 'Knowledge updates Mycelium prepared in the background, waiting for your OK.' },
      guide: { label: 'Open the guide', stage: 'Help', tip: 'The step-by-step Get Started walkthrough.' },
    },
  },
  ko: {
    today: '오늘', yesterday: '어제', thisWeek: '이번 주', earlier: '이전',
    unfiled: '미분류', unfiledTip: '아직 폴더에 정리되지 않음',
    hasKnowledge: 'KNOWLEDGE.md 있음', untitled: '제목 없음',
    resume: '이어하기', handoff: '핸드오프', copyPrompt: '핸드오프 프롬프트 복사', move: '이동…', tag: '태그…', summarize: '요약 만들기', copyId: 'ID 복사',
    notResumable: '병합·분할된 세션은 이어할 수 없습니다 — 핸드오프를 사용하세요',
    backlogNotResumable: '백로그 항목은 아직 실행된 적이 없습니다 — TUI에서 시작하세요',
    summary: '요약', decisions: '결정사항', todos: '할 일', files: '변경된 파일', lineage: '연결된 세션',
    noSummary: '아직 요약이 없습니다 — TUI의 a 키나 `mycelium autotag`로 만들 수 있습니다.',
    continuationOf: '이어받은 세션', continuedTo: '이어진 세션', mergedFrom: '병합 원본', splitFrom: '분할 원본', splitInto: '분할 결과',
    transcript: '대화 내용 보기', turns: '턴', thisMachine: '이 머신',
    ago: { now: '방금', m: (n) => `${n}분 전`, h: (n) => `${n}시간 전`, d: (n) => `${n}일 전`, w: (n) => `${n}주 전`, mo: (n) => `${n}개월 전` },
    here: '여기', newCount: '미분류',
    menuScan: '새 세션 스캔', menuOrganize: '스마트 정리', menuGuide: '가이드 열기', menuSearch: '세션 검색', menuNewAgent: '새 에이전트 세션 시작', menuOpen: 'Mycelium 사이드바 열기',
    dropTarget: '이 폴더로 이동',
    unfiledN: (n) => `미분류 ${n}`, waitingN: (n) => `대기 ${n}`,
    actions: {
      scan: { label: '새 세션 스캔', stage: 'Capture', tip: 'Claude Code, Codex, Kiro, OpenCode의 세션을 Mycelium으로 가져옵니다. 새 세션은 폴더 뷰의 미분류(New)에 나타납니다.' },
      summarize: { label: '세션 요약', stage: 'Learn · AI', tip: '세션에 제목, 태그, 요약, 결정사항, 할 일을 붙입니다 (한 번에 25개, 사용 중인 claude/codex 로그인 사용).' },
      organize: { label: '스마트 정리', stage: 'Organize · AI', tip: '미분류 세션마다 폴더를 제안합니다. 동의하는 것만 체크해서 적용하세요.' },
      knowledge: { label: '폴더 지식 추출', stage: 'Learn · AI', tip: '폴더 안 세션들이 결정한 내용을 KNOWLEDGE.md로 정리합니다. 저장하기 전에 diff를 검토합니다.' },
      search: { label: '세션 검색', stage: 'Find', tip: '모든 세션을 전체 텍스트로 검색합니다. 결과를 열고, 이어하거나 핸드오프할 수 있습니다.' },
      newAgent: { label: '새 에이전트 세션 시작', stage: 'Reuse', tip: '폴더에서 Claude, Codex 등을 시작합니다. 원하면 먼저 그 폴더의 지식을 AGENTS.md에 넣습니다.' },
      review: { label: '지식 업데이트 검토', stage: 'Learn', tip: 'Mycelium이 백그라운드에서 준비해 둔, 승인을 기다리는 지식 업데이트입니다.' },
      guide: { label: '가이드 열기', stage: '도움말', tip: '단계별 시작하기 가이드입니다.' },
    },
  },
};

/** `language` is vscode.env.language ('ko', 'ko-KR', 'en', …). */
function strings(language) {
  return String(language || '').toLowerCase().startsWith('ko') ? STR.ko : STR.en;
}

module.exports = { strings };
