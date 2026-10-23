/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

'use strict';

// Strings for everything the extension renders itself (the webview panel,
// tree groups, status bar). Manifest strings live in package.nls*.json.
const STR = {
  en: {
    today: 'Today', yesterday: 'Yesterday', thisWeek: 'This week', earlier: 'Earlier',
    unfiled: 'New', unfiledTip: 'Not filed into a folder yet',
    hasKnowledge: 'Has KNOWLEDGE.md', untitled: 'Untitled',
    resume: 'Resume', resumeTerminal: 'In terminal', resumeTerminalTip: 'Resume in a terminal instead of the Claude Code panel', handoff: 'Hand off', copyPrompt: 'Copy handoff prompt', move: 'Move…', tag: 'Tags…', delete: 'Delete', summarize: 'Summarize', copyId: 'Copy ID',
    notResumable: 'Merged or split sessions can’t be resumed — hand off instead',
    backlogAddPrompt: 'Backlog item title', backlogNotesPrompt: 'Notes for the agent (optional)', backlogUpdateOld: 'Mycelium CLI is too old for backlog. Update: npm install -g @kevinprk/mycelium', backlogRestart: 'This item was already started. Start it again?',
    backlogStart: 'Start', backlogEdit: 'Edit…', notes: 'Notes', noNotes: 'No notes yet — use Edit to add some.',
    backlogStarted: 'Started. It stays here until the session it began is captured (next scan); Start again to retry.',
    backlogIntro: 'A note for later: nothing has run yet. Start hands it to an agent as the first prompt.',
    summary: 'Summary', decisions: 'Decisions', todos: 'To do', lineage: 'Lineage',
    noSummary: 'No summary yet — run auto-tag in the TUI (a) or `mycelium autotag`.',
    continuationOf: 'Continues', continuedTo: 'Continued in', mergedFrom: 'Merged from', splitFrom: 'Split from', splitInto: 'Split into',
    transcript: 'View transcript', turns: 'turns', thisMachine: 'this machine',
    ago: { now: 'just now', m: (n) => `${n}m ago`, h: (n) => `${n}h ago`, d: (n) => `${n}d ago`, w: (n) => `${n}w ago`, mo: (n) => `${n}mo ago` },
    here: 'here', newCount: 'new',
    diagnosticsCopied: 'Mycelium: diagnostics copied to the clipboard. Paste them into your bug report.',
    menuScan: 'Scan for new sessions', menuOrganize: 'Smart organize', menuGuide: 'Open the guide', menuSearch: 'Search sessions', menuCalendar: 'Open the calendar', menuNewAgent: 'Start a new agent session', menuBacklog: 'Add a backlog item', menuOpen: 'Open the Mycelium sidebar',
    dropTarget: 'Move to this folder',
    cal: {
      weekdays: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
      months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
      prev: 'Previous month', next: 'Next month', today: 'Today',
      day: (m, d) => `${m} ${d}`,
      sessionsN: (n) => `${n} session${n === 1 ? '' : 's'}`,
      none: 'Nothing captured on this day.', pick: 'Pick a day to see its sessions.',
      untitled: 'Untitled',
    },
    unfiledN: (n) => `${n} unfiled`, waitingN: (n) => `${n} waiting`,
    actions: {
      scan: { label: 'Scan for new sessions', stage: 'Capture', tip: 'Pull sessions from Claude Code, Codex, Kiro and OpenCode into Mycelium. New ones appear under New in Folders.' },
      summarize: { label: 'Summarize sessions', stage: 'Learn · AI', tip: 'Give sessions a title, tags, summary, decisions and to-dos (25 at a time, using your own claude/codex login).' },
      organize: { label: 'Smart organize', stage: 'Organize · AI', tip: 'Suggest a folder for each unfiled session; you tick the ones you agree with.' },
      knowledge: { label: 'Extract folder knowledge', stage: 'Learn · AI', tip: 'Write what a folder’s sessions decided into its KNOWLEDGE.md. You review a diff before it is saved.' },
      search: { label: 'Search sessions', stage: 'Find', tip: 'Full-text search across every session; open a result, resume it or hand it off.' },
      newAgent: { label: 'Start a new agent session', stage: 'Reuse', tip: 'Start Claude, Codex… in a folder, optionally with that folder’s knowledge put into AGENTS.md first.' },
      backlog: { label: 'Add a backlog item', stage: 'Backlog', tip: 'Write down a task to start later. Start it from the tree and the agent gets your note as its first prompt.' },
      calendar: { label: 'Open the calendar', stage: 'Find · experimental', tip: 'A month grid of when sessions happened. Pick a day to see, open, resume or hand off its sessions.' },
      review: { label: 'Review knowledge updates', stage: 'Learn', tip: 'Knowledge updates Mycelium prepared in the background, waiting for your OK.' },
      guide: { label: 'Open the guide', stage: 'Help', tip: 'The step-by-step Get Started walkthrough.' },
    },
  },
  ko: {
    today: '오늘', yesterday: '어제', thisWeek: '이번 주', earlier: '이전',
    unfiled: '미분류', unfiledTip: '아직 폴더에 정리되지 않음',
    hasKnowledge: 'KNOWLEDGE.md 있음', untitled: '제목 없음',
    resume: '이어하기', resumeTerminal: '터미널에서', resumeTerminalTip: 'Claude Code 패널 대신 터미널에서 이어하기', handoff: '핸드오프', copyPrompt: '핸드오프 프롬프트 복사', move: '이동…', tag: '태그…', delete: '삭제', summarize: '요약 만들기', copyId: 'ID 복사',
    notResumable: '병합·분할된 세션은 이어할 수 없습니다 — 핸드오프를 사용하세요',
    backlogAddPrompt: '백로그 항목 제목', backlogNotesPrompt: '에이전트에게 전달할 메모 (선택)', backlogUpdateOld: '백로그를 쓰기에는 Mycelium CLI가 오래되었습니다. 업데이트: npm install -g @kevinprk/mycelium', backlogRestart: '이미 시작한 항목입니다. 다시 시작할까요?',
    backlogStart: '시작', backlogEdit: '수정…', notes: '메모', noNotes: '메모가 없습니다 — 수정에서 추가하세요.',
    backlogStarted: '시작했습니다. 이 항목에서 시작된 세션이 캡처될 때(다음 스캔)까지 남아 있으며, 다시 시작해 재시도할 수 있습니다.',
    backlogIntro: '나중을 위한 메모입니다. 아직 실행된 것이 없으며, 시작하면 에이전트에게 첫 프롬프트로 전달됩니다.',
    summary: '요약', decisions: '결정사항', todos: '할 일', lineage: '연결된 세션',
    noSummary: '아직 요약이 없습니다 — TUI의 a 키나 `mycelium autotag`로 만들 수 있습니다.',
    continuationOf: '이어받은 세션', continuedTo: '이어진 세션', mergedFrom: '병합 원본', splitFrom: '분할 원본', splitInto: '분할 결과',
    transcript: '대화 내용 보기', turns: '턴', thisMachine: '이 머신',
    ago: { now: '방금', m: (n) => `${n}분 전`, h: (n) => `${n}시간 전`, d: (n) => `${n}일 전`, w: (n) => `${n}주 전`, mo: (n) => `${n}개월 전` },
    here: '여기', newCount: '미분류',
    diagnosticsCopied: 'Mycelium: 진단 정보를 클립보드에 복사했습니다. 버그 제보에 붙여넣어 주세요.',
    menuScan: '새 세션 스캔', menuOrganize: '스마트 정리', menuGuide: '가이드 열기', menuSearch: '세션 검색', menuCalendar: '캘린더 열기', menuNewAgent: '새 에이전트 세션 시작', menuBacklog: '백로그 항목 추가', menuOpen: 'Mycelium 사이드바 열기',
    dropTarget: '이 폴더로 이동',
    cal: {
      weekdays: ['일', '월', '화', '수', '목', '금', '토'],
      months: ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'],
      prev: '이전 달', next: '다음 달', today: '오늘',
      day: (m, d) => `${m} ${d}일`,
      sessionsN: (n) => `세션 ${n}개`,
      none: '이 날 캡처된 세션이 없습니다.', pick: '날짜를 선택하면 그날의 세션이 보입니다.',
      untitled: '제목 없음',
    },
    unfiledN: (n) => `미분류 ${n}`, waitingN: (n) => `대기 ${n}`,
    actions: {
      scan: { label: '새 세션 스캔', stage: 'Capture', tip: 'Claude Code, Codex, Kiro, OpenCode의 세션을 Mycelium으로 가져옵니다. 새 세션은 폴더 뷰의 미분류(New)에 나타납니다.' },
      summarize: { label: '세션 요약', stage: 'Learn · AI', tip: '세션에 제목, 태그, 요약, 결정사항, 할 일을 붙입니다 (한 번에 25개, 사용 중인 claude/codex 로그인 사용).' },
      organize: { label: '스마트 정리', stage: 'Organize · AI', tip: '미분류 세션마다 폴더를 제안합니다. 동의하는 것만 체크해서 적용하세요.' },
      knowledge: { label: '폴더 지식 추출', stage: 'Learn · AI', tip: '폴더 안 세션들이 결정한 내용을 KNOWLEDGE.md로 정리합니다. 저장하기 전에 diff를 검토합니다.' },
      search: { label: '세션 검색', stage: 'Find', tip: '모든 세션을 전체 텍스트로 검색합니다. 결과를 열고, 이어하거나 핸드오프할 수 있습니다.' },
      newAgent: { label: '새 에이전트 세션 시작', stage: 'Reuse', tip: '폴더에서 Claude, Codex 등을 시작합니다. 원하면 먼저 그 폴더의 지식을 AGENTS.md에 넣습니다.' },
      backlog: { label: '백로그 항목 추가', stage: 'Backlog', tip: '나중에 시작할 작업을 적어 둡니다. 트리에서 시작하면 에이전트가 메모를 첫 프롬프트로 받습니다.' },
      calendar: { label: '캘린더 열기', stage: 'Find · 실험적', tip: '세션이 언제 있었는지 월 단위로 보여 줍니다. 날짜를 고르면 그날의 세션을 열고, 이어하고, 핸드오프할 수 있습니다.' },
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
