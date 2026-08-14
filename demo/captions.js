// Caption cues for the burned-in captions demo/burn-captions.js overlays
// onto the rendered pitch-en.mp4/pitch-ko.mp4. One cue per beat, skipping
// the intro/outro banners (they already carry their own full text on
// screen — a caption would just repeat it).
//
// `start`/`holdSeconds` are real seconds into the RENDERED video, not
// hand-computed from the tape script's Sleep/Type/Wait durations — an
// initial attempt at computing them that way (typing-speed math + a
// calibrated Wait-resolution constant) tracked real frames closely for the
// first ~100s but drifted 14-18s late from the handoff beat onward (likely
// the relaunch's real Node startup time, not modeled). Every timestamp
// below was instead confirmed against real extracted frames
// (`ffmpeg -ss <t> -vframes 1` + visual check) from the final pitch-en.mp4
// render — same discipline as every other beat in this project. EN and KO
// renders land within 0.5s of each other in total duration (171.76s vs
// 171.2s) and share an identical structure, so the same timestamps are
// reused for both rather than re-deriving a separate KO timeline.

const CUES_EN = [
  { start: 13, holdSeconds: 3, text: 'Install once, then just run `mycelium`' },
  { start: 22, holdSeconds: 5, text: 'Organize — AI reads unfiled sessions and suggests folders' },
  { start: 41, holdSeconds: 5, text: "Learn — extracts a folder's KNOWLEDGE.md from its sessions" },
  { start: 50, holdSeconds: 5, text: 'Reuse — the context a new session in this folder would inherit' },
  { start: 58, holdSeconds: 4, text: 'Review knowledge updates across every active folder at once' },
  { start: 73, holdSeconds: 4, text: 'Merge — combine related sessions, see the real result on entering it' },
  { start: 90, holdSeconds: 4, text: 'Split — back into topic-sized pieces, each real on its own' },
  { start: 100, holdSeconds: 4, text: 'Handoff — send this session to a different agent, with context' },
  { start: 108, holdSeconds: 4, text: "The folder's knowledge, injected into a real AGENTS.md" },
  { start: 118, holdSeconds: 5, text: 'The other agent picks up — linked back automatically' },
  { start: 128, holdSeconds: 4, text: 'Search — find sessions by content, across folders' },
  { start: 134, holdSeconds: 6, text: 'Calendar — browse by day, not just by folder' },
];

const CUES_KO = [
  { start: 13, holdSeconds: 3, text: '한 번 설치하면, 그다음은 `mycelium` 실행만 하면 됩니다' },
  { start: 22, holdSeconds: 5, text: '정리 — AI가 미분류 세션을 읽고 폴더를 제안합니다' },
  { start: 41, holdSeconds: 5, text: '학습 — 폴더의 세션들로부터 KNOWLEDGE.md를 추출합니다' },
  { start: 50, holdSeconds: 5, text: '재사용 — 이 폴더의 새 세션이 물려받을 컨텍스트' },
  { start: 58, holdSeconds: 4, text: '모든 활성 폴더의 지식 업데이트를 한 번에 검토합니다' },
  { start: 73, holdSeconds: 4, text: '병합 — 관련 세션을 합치고, 실제 들어가서 결과를 확인합니다' },
  { start: 90, holdSeconds: 4, text: '분할 — 주제 단위로 다시 나누고, 각각 실제로 확인합니다' },
  { start: 100, holdSeconds: 4, text: '핸드오프 — 컨텍스트와 함께 다른 에이전트로 세션을 넘깁니다' },
  { start: 108, holdSeconds: 4, text: '폴더의 지식이 실제 AGENTS.md 파일에 주입됩니다' },
  { start: 118, holdSeconds: 5, text: '다른 에이전트가 이어받음 — 자동으로 연결됩니다' },
  { start: 128, holdSeconds: 4, text: '검색 — 폴더를 넘나들며 내용으로 세션을 찾습니다' },
  { start: 134, holdSeconds: 6, text: '캘린더 — 폴더가 아니라 날짜로 둘러봅니다' },
];

export const CAPTIONS = { en: CUES_EN, ko: CUES_KO };
