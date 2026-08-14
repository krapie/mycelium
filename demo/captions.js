// Caption cues for the burned-in captions demo/burn-captions.js overlays
// onto the rendered pitch-en.mp4/pitch-ko.mp4. One cue per beat, skipping
// the intro/outro banners (they already carry their own full text on
// screen — a caption would just repeat it).
//
// `start` is when the STEP ACTUALLY BEGINS (the keypress that starts it —
// for LLM-backed steps, that's when the loading spinner first appears, e.g.
// "Summarizing + classifying sessions…" — not when the spinner finishes and
// the result modal settles). An earlier version of this file used the
// "already settled" timestamp for every cue, which reads as the caption
// trailing 4-10s behind the actual step — confirmed by checking frames
// right at and shortly after each keypress (e.g. organize's spinner is
// already visible at t=18, well before the "Suggested placements" list
// itself appears around t=23). `holdSeconds` deliberately spans through
// that spinner-to-result window, so the caption is still up when the result
// lands, not just during the wait.
//
// Every timestamp confirmed against real extracted frames
// (`ffmpeg -ss <t> -vframes 1` + visual check) from the final pitch-en.mp4
// render — not hand-computed from the tape script, which drifts from
// reality (see git history). EN and KO renders land within 0.5s of each
// other in total duration and share an identical structure, so the same
// timestamps are reused for both rather than re-deriving a separate KO
// timeline.

const CUES_EN = [
  { start: 13, holdSeconds: 3, text: 'Install once, then just run `mycelium`' },
  { start: 18, holdSeconds: 6, text: 'Organize — AI reads unfiled sessions and suggests folders' },
  { start: 37, holdSeconds: 6, text: "Learn — extracts a folder's KNOWLEDGE.md from its sessions" },
  { start: 49, holdSeconds: 5, text: 'Reuse — the context a new session in this folder would inherit' },
  { start: 58, holdSeconds: 5, text: 'Review knowledge updates across every active folder at once' },
  { start: 69, holdSeconds: 5, text: 'Merge — combine related sessions, see the real result on entering it' },
  { start: 80, holdSeconds: 5, text: 'Split — back into topic-sized pieces, each real on its own' },
  { start: 96, holdSeconds: 4, text: 'Handoff — send this session to a different agent, with context' },
  { start: 105, holdSeconds: 4, text: "The folder's knowledge, injected into a real AGENTS.md" },
  { start: 114, holdSeconds: 5, text: 'The other agent picks up — linked back automatically' },
  { start: 120, holdSeconds: 4, text: 'Search — find sessions by content, across folders' },
  { start: 129, holdSeconds: 6, text: 'Calendar — browse by day, not just by folder' },
];

const CUES_KO = [
  { start: 13, holdSeconds: 3, text: '한 번 설치하면, 그다음은 `mycelium` 실행만 하면 됩니다' },
  { start: 18, holdSeconds: 6, text: '정리 — AI가 미분류 세션을 읽고 폴더를 제안합니다' },
  { start: 37, holdSeconds: 6, text: '학습 — 폴더의 세션들로부터 KNOWLEDGE.md를 추출합니다' },
  { start: 49, holdSeconds: 5, text: '재사용 — 이 폴더의 새 세션이 물려받을 컨텍스트' },
  { start: 58, holdSeconds: 5, text: '모든 활성 폴더의 지식 업데이트를 한 번에 검토합니다' },
  { start: 69, holdSeconds: 5, text: '병합 — 관련 세션을 합치고, 실제 들어가서 결과를 확인합니다' },
  { start: 80, holdSeconds: 5, text: '분할 — 주제 단위로 다시 나누고, 각각 실제로 확인합니다' },
  { start: 96, holdSeconds: 4, text: '핸드오프 — 컨텍스트와 함께 다른 에이전트로 세션을 넘깁니다' },
  { start: 105, holdSeconds: 4, text: '폴더의 지식이 실제 AGENTS.md 파일에 주입됩니다' },
  { start: 114, holdSeconds: 5, text: '다른 에이전트가 이어받음 — 자동으로 연결됩니다' },
  { start: 120, holdSeconds: 4, text: '검색 — 폴더를 넘나들며 내용으로 세션을 찾습니다' },
  { start: 129, holdSeconds: 6, text: '캘린더 — 폴더가 아니라 날짜로 둘러봅니다' },
];

export const CAPTIONS = { en: CUES_EN, ko: CUES_KO };
