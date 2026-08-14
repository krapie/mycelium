// Bilingual (en/ko) content for the one extra session
// demo/seed-pitch-continuation.js seeds after the pitch video's handoff (`h`)
// beat — depicts the agent picked in the handoff (Claude Code) actually
// picking up the work, using the AGENTS.md context that handoff just
// injected. Real session data shape, but written like every other session
// in this dataset (hand-authored, not a real capture) — what's REAL here is
// the linkContinuation() call seed-pitch-continuation.js makes with it, the
// exact function a genuine handoff-and-capture would call.

export const PITCH_CONTINUATION = {
  source: 'claude',
  folder: 'auth/token-refresh',
  title: {
    en: 'Continue: verify concurrency fix after handoff',
    ko: '이어서 진행: 핸드오프 이후 동시성 수정 확인',
  },
  summary: {
    en:
      'Picked up the concurrency-lock fix via handoff. Reviewed the injected AGENTS.md context first instead of ' +
      're-reading the whole history — confirmed the in-flight refresh promise approach is already in place, ran ' +
      'the 5-concurrent-request integration test locally, and it passes. Nothing left to do here.',
    ko:
      '핸드오프를 통해 동시성 락 수정 작업을 이어받음. 전체 히스토리를 다시 읽는 대신 주입된 AGENTS.md 컨텍스트부터 ' +
      '확인 — 진행 중인 리프레시 프로미스 방식이 이미 반영되어 있음을 확인했고, 동시 요청 5개짜리 통합 테스트를 ' +
      '로컬에서 실행해 통과함을 확인. 더 할 일 없음.',
  },
  tags: ['backend', 'auth', 'concurrency'],
  turns: [
    {
      role: 'user',
      en: "Picking up the concurrency lock fix from the handoff — reviewed AGENTS.md, makes sense.",
      ko: '핸드오프로 넘어온 동시성 락 수정 작업을 이어받는 중이에요 — AGENTS.md를 확인했는데 이해가 되네요.',
    },
    {
      role: 'assistant',
      en:
        "Confirmed the in-flight refresh promise approach is already in place per the injected knowledge — no need " +
        "to re-derive it from scratch. Ran the 5-concurrent-request integration test locally and it passes. " +
        "Nothing left to do here.",
      ko:
        '주입된 지식을 보니 진행 중인 리프레시 프로미스 방식이 이미 반영되어 있는 걸 확인했어요 — 처음부터 다시 알아낼 ' +
        '필요가 없었습니다. 동시 요청 5개짜리 통합 테스트를 로컬에서 실행해봤고 통과했어요. 더 할 일은 없습니다.',
    },
  ],
};
