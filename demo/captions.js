// Caption cues for the burned-in captions demo/burn-captions.js overlays
// onto the rendered pitch-en.mp4/pitch-ko.mp4. One cue per beat, skipping
// the intro/outro banners (they already carry their own full text on
// screen — a caption would just repeat it).
//
// Instructional, not marketing copy: each cue names the actual key pressed
// (matching the tutorial's own voice — i18n.js's tutorial.step2Body etc.,
// "Press o to have Mycelium read them and suggest folders") so the video
// doubles as a how-to-use-it guide, not just a feature pitch. An earlier
// version read like ad copy ("Organize — AI reads unfiled sessions and
// suggests folders") with no mention of the key that actually does it.
//
// `start` is when the STEP ACTUALLY BEGINS (the keypress that starts it —
// for LLM-backed steps, that's when the loading spinner first appears, not
// when it resolves — see git history for why: an earlier pass anchored
// every cue to the settled result and read as trailing 4-11s behind).
// `holdSeconds` spans through the spinner-to-result window. Every timestamp
// confirmed against real extracted frames (`ffmpeg -ss <t> -vframes 1` +
// visual check) from the final render, re-verified after the merge/split/
// continuation drill-in beats were removed (see pitch-en.tape) — not
// hand-computed from the tape script, which drifts from reality.
//
// EN and KO renders land within 0.5s of each other in total duration and
// share an identical structure, so the same timestamps are reused for both
// rather than re-deriving a separate KO timeline.

const CUES_EN = [
  { start: 13, holdSeconds: 3, text: 'Install with `npm install -g @kevinprk/mycelium`, then run `mycelium`' },
  { start: 18, holdSeconds: 6, text: 'Press `o` to organize — AI reads unfiled sessions and suggests folders' },
  { start: 37, holdSeconds: 6, text: "Press `w` to learn — extracts this folder's KNOWLEDGE.md" },
  { start: 49, holdSeconds: 5, text: 'Press `c` to see the context a new session here would inherit' },
  { start: 58, holdSeconds: 5, text: 'Press `k` to review knowledge updates across every active folder' },
  { start: 69, holdSeconds: 4, text: 'Select sessions, press Shift+M to merge them for review' },
  { start: 73, holdSeconds: 5, text: 'Press Shift+S to split work back into topic-sized pieces' },
  { start: 85, holdSeconds: 5, text: 'Press `h` to hand this session to a different agent, with context' },
  { start: 92, holdSeconds: 5, text: 'That context is injected into a real AGENTS.md for the next agent' },
  { start: 97, holdSeconds: 6, text: 'The next agent picks up automatically — linked back to the original' },
  { start: 108, holdSeconds: 4, text: 'Press `/` to search sessions by content, across folders' },
  { start: 114, holdSeconds: 6, text: 'Press `v` to browse sessions by calendar day' },
];

const CUES_KO = [
  { start: 13, holdSeconds: 3, text: '`npm install -g @kevinprk/mycelium`로 설치한 뒤 `mycelium`을 실행하세요' },
  { start: 18, holdSeconds: 6, text: '`o`를 눌러 정리 — AI가 미분류 세션을 읽고 폴더를 제안합니다' },
  { start: 37, holdSeconds: 6, text: '`w`를 눌러 학습 — 이 폴더의 KNOWLEDGE.md를 추출합니다' },
  { start: 49, holdSeconds: 5, text: '`c`를 눌러 이 폴더의 새 세션이 물려받을 컨텍스트를 확인하세요' },
  { start: 58, holdSeconds: 5, text: '`k`를 눌러 모든 활성 폴더의 지식 업데이트를 검토하세요' },
  { start: 69, holdSeconds: 4, text: '세션을 선택하고 Shift+M으로 검토를 위해 병합하세요' },
  { start: 73, holdSeconds: 5, text: 'Shift+S로 작업을 다시 주제 단위로 분할하세요' },
  { start: 85, holdSeconds: 5, text: '`h`를 눌러 컨텍스트와 함께 다른 에이전트로 세션을 넘기세요' },
  { start: 92, holdSeconds: 5, text: '그 컨텍스트가 다음 에이전트를 위해 실제 AGENTS.md에 주입됩니다' },
  { start: 97, holdSeconds: 6, text: '다음 에이전트가 자동으로 이어받아 원본과 연결됩니다' },
  { start: 108, holdSeconds: 4, text: '`/`를 눌러 폴더를 넘나들며 내용으로 세션을 검색하세요' },
  { start: 114, holdSeconds: 6, text: '`v`를 눌러 날짜별로 세션을 둘러보세요' },
];

export const CAPTIONS = { en: CUES_EN, ko: CUES_KO };
