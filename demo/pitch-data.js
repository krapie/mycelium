// Bilingual (en/ko) mock content for the flagship pitch video
// (demo/tapes/pitch-en.tape, pitch-ko.tape) — NOT shipped, NOT part of
// src/tui/personas.js/the real interactive tutorial, but deliberately
// SHAPED like it (folder/keywords/knowledge/splitLabels per storyline,
// title/summary/tags/turns per session) so demo/pitch-launch.js can drive
// it through src/tui/tutorial-mock-llm.js's own createMockProvider() /
// resolveStorylines() instead of a second, hand-rolled mock implementation.
//
// Unlike the persona tutorial's 6 sessions, this is a richer 12-session/
// 4-folder SWE-flavored dataset ("sufficient amount of mock sessions and
// folders from a SWE perspective" — the original request behind this
// video). Every session's title/summary is PRE-FILLED (unlike an earlier
// version of this file, which deliberately left it blank so the real LLM
// would summarize on camera) — this video now runs entirely against the
// mocked provider (see demo/pitch-launch.js), the same speed/determinism
// tradeoff src/tui/tutorial-data.js's buildMockSessions() already makes for
// the interactive tutorial, made here for the same reason: a real classify/
// summarize call took 110-150s+ per render, which is most of a 3-minute
// video spent watching a progress bar, and made showing more than
// organize+learn+reuse impractical. See demo/README.md's "pitch video"
// section for the full rationale.
//
// `folder`/`tags` stay single, shared, ASCII values in both languages
// (real project folder names stay English even on Korean-speaking teams —
// same convention personas.js documents). `keywords` is genuinely
// language-SPECIFIC (matched against whichever language the mock summary
// is actually rendered in), not just a translation — mirrors personas.js's
// own doc comment on this exact point.

function turn(role, en, ko) {
  return { role, en, ko };
}

export const PITCH_STORYLINES = [
  // Merge target: 2 of these 3 sessions (proactive refresh + retry/backoff)
  // get merged "for review" in the live demo; the 3rd (concurrency lock)
  // stays its own session in the same folder — mirrors personas.js's own
  // 2-of-3 merge pattern exactly. splitLabels then divides the merged
  // session's 8 turns back into these same two halves.
  {
    folder: 'auth/token-refresh',
    keywords: {
      en: /token|refresh|401|expiry/i,
      ko: /토큰|리프레시|갱신|만료/i,
    },
    knowledge: {
      en: `## Token refresh hardening

- **Proactive, not reactive**: refresh when a token has under 60s left, not only after a 401 — a request landing exactly at expiry otherwise gets a hard failure instead of a silent refresh.
- **Backoff scoped to the refresh call only**: retry the refresh endpoint (3 attempts, 200/400/800ms) on 503, never the original request — that decision was already made and shouldn't be retried blindly.
- **Single in-flight refresh**: concurrent requests near expiry must await one shared refresh promise, not each start their own — otherwise the second silently overwrites the first token in cache.`,
      ko: `## 토큰 갱신 견고화

- **선제적으로, 반응형이 아니라**: 401이 난 뒤가 아니라 만료까지 60초 미만 남았을 때 미리 갱신한다 — 그렇지 않으면 만료 시점에 정확히 걸린 요청이 조용한 갱신 대신 그대로 실패한다.
- **백오프는 리프레시 호출에만 적용**: 503 발생 시 리프레시 엔드포인트만 재시도(3회, 200/400/800ms)하고 원래 요청은 재시도하지 않는다 — 원 요청은 이미 결정이 끝난 상태라 무작정 재시도하면 안 된다.
- **동시 리프레시는 하나만**: 만료 근처 동시 요청들은 각자 새 리프레시를 시작하는 대신 공유된 단일 리프레시 프로미스를 기다려야 한다 — 안 그러면 두 번째가 캐시의 첫 토큰을 조용히 덮어쓴다.`,
    },
    splitLabels: {
      en: ['Proactive refresh', 'Retry & concurrency hardening'],
      ko: ['선제적 갱신', '재시도 및 동시성 견고화'],
    },
    sessions: [
      {
        source: 'codex',
        daysAgo: 1,
        title: { en: 'Add proactive token refresh before expiry', ko: '만료 전 선제적 토큰 갱신 추가' },
        summary: {
          en:
            'Investigated intermittent production 401s spiking near the 1-hour token boundary. Root cause: no ' +
            'proactive refresh, so requests landing exactly at expiry got a hard 401 instead of a silent refresh. ' +
            'Added a check that refreshes when the token has under 60 seconds left, plus a boundary-case test.',
          ko:
            '1시간 토큰 경계 근처에서 몰리는 프로덕션 간헐적 401을 조사. 원인은 선제적 갱신이 없어 만료 시점에 걸린 ' +
            '요청이 조용히 갱신되는 대신 401을 받는 것. 만료까지 60초 이내면 미리 갱신하는 체크와 경계 케이스 테스트를 추가.',
        },
        tags: ['backend', 'auth', 'nodejs'],
        turns: [
          turn(
            'user',
            "We're seeing intermittent 401s in production, seems to spike right around the 1-hour mark. Can you check if it's a token expiry issue?",
            '프로덕션에서 간헐적으로 401이 발생하는데, 1시간 지점 근처에서 몰리는 것 같아요. 토큰 만료 문제인지 확인해줄래요?',
          ),
          turn(
            'assistant',
            "Looked at the auth middleware — refresh tokens are valid for 1h but there's no proactive refresh, so any request landing exactly at expiry gets a hard 401 instead of a silent refresh. I'll add a check that refreshes if the token expires within the next 60 seconds.",
            '인증 미들웨어를 확인했습니다 — 리프레시 토큰은 1시간 동안 유효한데 선제적 갱신이 없어서, 만료 시점에 정확히 걸리는 요청은 조용히 갱신되는 대신 401을 그대로 받습니다. 만료까지 60초 이내로 남으면 미리 갱신하는 체크를 추가하겠습니다.',
          ),
          turn(
            'user',
            'That should cover it. Add a test for the boundary case.',
            '그 정도면 될 것 같아요. 경계 케이스 테스트도 추가해주세요.',
          ),
          turn(
            'assistant',
            'Added a test that mocks a token expiring in 30s and confirms the client refreshes before the request goes out, plus a control test for a token with plenty of time left.',
            '30초 뒤 만료되는 토큰을 모킹해서 요청 전에 클라이언트가 갱신하는지 확인하는 테스트를 추가했고, 여유 시간이 충분한 토큰에 대한 대조 테스트도 함께 추가했습니다.',
          ),
        ],
      },
      {
        source: 'claude',
        daysAgo: 2,
        title: { en: 'Add retry/backoff around the flaky refresh endpoint', ko: '불안정한 리프레시 엔드포인트에 재시도/백오프 추가' },
        summary: {
          en:
            'The refresh endpoint occasionally 503s under load, previously failing the whole request. Added ' +
            'exponential backoff (3 attempts, 200/400/800ms) scoped to the refresh call only, not the original ' +
            'request. Logs each retry attempt for dashboard visibility.',
          ko:
            '리프레시 엔드포인트가 부하 시 간헐적으로 503을 내며 요청 전체를 실패시키던 문제. 리프레시 호출에만 ' +
            '지수 백오프(3회, 200/400/800ms)를 추가하고 원 요청은 대상에서 제외. 각 재시도를 로그로 남겨 대시보드에서 확인 가능하게 함.',
        },
        tags: ['backend', 'auth', 'reliability'],
        turns: [
          turn(
            'user',
            "The refresh endpoint itself sometimes 503s under load. Right now a failed refresh just fails the whole request.",
            '리프레시 엔드포인트 자체가 부하가 있을 때 503을 낼 때가 있어요. 지금은 리프레시가 실패하면 요청 전체가 그냥 실패해버려요.',
          ),
          turn(
            'assistant',
            "Added exponential backoff (3 attempts, 200ms/400ms/800ms) around the refresh call specifically — not the original request, since that's already been decided and shouldn't be retried blindly. If all 3 attempts fail we still surface the original 401, just later.",
            '리프레시 호출에만 지수 백오프(3회, 200ms/400ms/800ms)를 추가했습니다 — 원래 요청은 이미 결정된 상태라 무작정 재시도하면 안 되니 대상에서 뺐어요. 3번 다 실패하면 원래의 401을 그대로 보여주되, 시점만 조금 늦춰집니다.',
          ),
          turn(
            'user',
            'Good, and log each retry attempt so we can see it in the dashboards.',
            '좋아요, 각 재시도를 로그로 남겨서 대시보드에서 볼 수 있게 해주세요.',
          ),
          turn(
            'assistant',
            "Done — each retry attempt logs the attempt number and delay, tagged so it's filterable separately from normal auth failures.",
            '완료했습니다 — 각 재시도마다 시도 횟수와 지연 시간을 로그로 남기고, 일반 인증 실패와 별도로 필터링할 수 있게 태그를 붙였습니다.',
          ),
        ],
      },
      {
        source: 'kiro',
        // Deliberately older than the other two (daysAgo 1/2) rather than
        // matching one of them exactly — this session stays UNMERGED in the
        // live demo, and its startedAt must sort unambiguously after (i.e.
        // more-recent-first-below) the merged product's startedAt (which
        // inherits the EARLIER of the two merged originals' timestamps, see
        // organize/lineage.js's mergeSessions()) so the merged row lands
        // deterministically at the top of the folder's session list — no
        // same-day randomized-minute ambiguity to fight when the tape
        // navigates to it right after merging.
        daysAgo: 3,
        title: { en: 'Fix duplicate refresh race near token expiry', ko: '토큰 만료 근처 중복 리프레시 레이스 수정' },
        summary: {
          en:
            'Two concurrent requests near expiry could each trigger their own refresh, with the second silently ' +
            'overwriting the first token in cache. Added a single in-flight refresh promise concurrent callers ' +
            'await instead of starting their own, plus an integration test firing 5 concurrent requests at the boundary.',
          ko:
            '만료 근처 동시 요청 두 개가 각자 리프레시를 트리거해 두 번째가 캐시의 첫 토큰을 조용히 덮어쓰던 문제. ' +
            '동시 호출자가 각자 시작하는 대신 기다릴 수 있는 단일 진행 중 리프레시 프로미스를 추가하고, 경계에서 동시 요청 5개를 쏘는 통합 테스트를 작성.',
        },
        tags: ['backend', 'auth', 'concurrency'],
        turns: [
          turn(
            'user',
            'Two requests firing at almost the same time near token expiry — I think they might both trigger a refresh independently.',
            '토큰 만료 시점 근처에서 요청 두 개가 거의 동시에 나가면, 둘 다 각자 리프레시를 트리거할 것 같아요.',
          ),
          turn(
            'assistant',
            "Confirmed it — there's no lock around the refresh call, so two concurrent requests near expiry both kick off their own refresh, and the second one silently overwrites the first token in the cache. Added a single in-flight refresh promise that concurrent callers await instead of starting their own.",
            '확인했습니다 — 리프레시 호출에 락이 없어서, 만료 근처의 동시 요청 두 개가 각자 리프레시를 시작하고 두 번째 것이 캐시의 첫 번째 토큰을 조용히 덮어씁니다. 동시 호출자들이 각자 새로 시작하는 대신 기다릴 수 있는 단일 진행 중 리프레시 프로미스를 추가했습니다.',
          ),
          turn(
            'user',
            'Add a test that actually exercises the race, not just unit-tests the lock.',
            '락만 단위 테스트하지 말고, 실제로 레이스 상황을 재현하는 테스트도 추가해주세요.',
          ),
          turn(
            'assistant',
            'Wrote an integration test that fires 5 concurrent requests right at the expiry boundary and asserts exactly one refresh call was made to the auth server.',
            '만료 경계 시점에 동시 요청 5개를 날리고 인증 서버로 리프레시 호출이 정확히 한 번만 갔는지 확인하는 통합 테스트를 작성했습니다.',
          ),
        ],
      },
    ],
  },

  {
    folder: 'ci/flaky-tests',
    keywords: {
      en: /flaky|CI run|shard|retry/i,
      ko: /플레이키|CI\s*실행|샤딩|재시도/i,
    },
    knowledge: {
      en: `## CI reliability

- **Flaky ≠ broken app logic**: most flakes traced back to a test asserting immediately after an action instead of waiting for the actual async result — fix the wait, not the assertion.
- **Retry only what's explicitly tagged**: a generic retry-everything wrapper hides real bugs; \`retryFlaky()\` only retries tests tagged \`@flaky-network\`, and still fails loudly (with a logged trail) after the retry budget is spent.
- **Shard by measured time, not file count**: checkout/auth specs are far slower than the rest — an even split by file count leaves one shard overloaded. Balancing by historical run time cut the full run from 22 to ~7 minutes.`,
      ko: `## CI 신뢰성

- **플레이키 ≠ 앱 로직 결함**: 대부분의 플레이키는 실제 비동기 결과를 기다리지 않고 액션 직후 바로 검증하는 패턴에서 비롯됨 — 검증이 아니라 대기를 고쳐야 한다.
- **명시적으로 태그된 것만 재시도**: 모든 걸 재시도하는 범용 래퍼는 진짜 버그를 숨긴다 — \`retryFlaky()\`는 \`@flaky-network\` 태그가 붙은 테스트만 재시도하고, 재시도 예산을 다 쓰면 로그와 함께 확실히 실패한다.
- **파일 개수가 아니라 측정된 시간으로 샤딩**: checkout/auth 스펙이 나머지보다 훨씬 느려서, 파일 개수로 균등 분할하면 한 샤드에 부하가 몰린다. 실행 시간 기준 균형 분할로 전체 실행이 22분에서 약 7분으로 줄었다.`,
    },
    sessions: [
      {
        source: 'claude',
        daysAgo: 3,
        title: { en: "Fix checkout.spec.ts flakiness — missing wait for async confirmation", ko: 'checkout.spec.ts 플레이키 수정 — 비동기 확인 대기 누락' },
        summary: {
          en:
            "checkout.spec.ts failed ~1 in 10 CI runs but never locally — a timing issue where the test asserted " +
            "the confirmation page immediately after clicking 'Place Order', racing the async confirmation call. " +
            "Added an explicit wait for the confirmation element, then found and fixed 2 more specs with the same " +
            "click-then-assert pattern.",
          ko:
            "checkout.spec.ts가 CI에서 10번 중 1번꼴로 실패했지만 로컬에서는 재현 안 됨 — '주문하기' 클릭 직후 확인 " +
            '페이지를 검증해 비동기 확인 호출과 경합하는 타이밍 문제. 확인 요소에 대한 명시적 대기를 추가했고, 같은 패턴을 쓰는 스펙 2개를 더 찾아 함께 수정.',
        },
        tags: ['testing', 'ci', 'e2e'],
        turns: [
          turn(
            'user',
            "checkout.spec.ts fails about 1 in 10 runs on CI but never locally. Can you dig in?",
            'checkout.spec.ts가 CI에서 10번 중 1번꼴로 실패하는데 로컬에서는 한 번도 안 그래요. 좀 파봐줄래요?',
          ),
          turn(
            'assistant',
            "It's a timing issue — the test clicks 'Place Order' and immediately asserts the confirmation page, but the order-confirmation call is async and CI's just slower under load than our machines. Added an explicit wait for the confirmation element instead of assuming it's already there.",
            '타이밍 문제였습니다 — 테스트가 \'주문하기\'를 클릭하고 바로 확인 페이지를 검증하는데, 주문 확인 호출이 비동기라 CI가 부하 상태에서 우리 로컬 머신보다 느립니다. 확인 요소가 이미 있다고 가정하는 대신 명시적으로 기다리도록 추가했습니다.',
          ),
          turn(
            'user',
            'Any chance this affects other specs with the same pattern?',
            '같은 패턴을 쓰는 다른 스펙들도 영향받을 가능성이 있을까요?',
          ),
          turn(
            'assistant',
            'Grepped for the same immediate-assert-after-click pattern — found 2 more specs doing it (refund flow, address update). Fixed all three the same way.',
            '클릭 직후 바로 검증하는 같은 패턴을 grep으로 찾아봤더니 2개가 더 있었습니다(환불 플로우, 주소 변경). 셋 다 같은 방식으로 고쳤습니다.',
          ),
        ],
      },
      {
        source: 'codex',
        daysAgo: 4,
        title: { en: 'Add a tagged retry wrapper for network-flaky tests', ko: '네트워크 플레이키 테스트용 태그 기반 재시도 래퍼 추가' },
        summary: {
          en:
            'Rather than fixing every flaky test individually, added retryFlaky() — retries up to 2 times, but ' +
            'only for tests explicitly tagged @flaky-network, so it never masks genuine bugs elsewhere. Logs a ' +
            'warning on every retry so which tests are actually flaky stays visible over time; a 3rd failure still ' +
            'fails the suite normally.',
          ko:
            '플레이키 테스트를 하나씩 고치는 대신 retryFlaky() 래퍼를 추가 — @flaky-network 태그가 붙은 테스트에 ' +
            '한해 최대 2회 재시도하여 다른 테스트의 진짜 버그를 가리지 않게 함. 재시도마다 경고 로그를 남겨 실제로 ' +
            '어떤 테스트가 플레이키한지 계속 보이게 하며, 3번째 실패는 평소대로 스위트를 실패시킴.',
        },
        tags: ['testing', 'ci', 'reliability'],
        turns: [
          turn(
            'user',
            'Rather than fixing each flaky test one by one, can we add a general retry mechanism for tests that hit real network calls?',
            '플레이키 테스트를 하나씩 고치는 대신, 실제 네트워크 호출을 하는 테스트들을 위한 범용 재시도 메커니즘을 추가할 수 있을까요?',
          ),
          turn(
            'assistant',
            "Added a `retryFlaky()` wrapper — retries up to 2 times ONLY for tests explicitly tagged `@flaky-network`, so it doesn't mask genuine bugs in tests that aren't network-dependent. Logs a warning on any retry so we can still see which tests are actually flaky over time.",
            '`retryFlaky()` 래퍼를 추가했습니다 — `@flaky-network` 태그가 명시적으로 붙은 테스트에 한해서만 최대 2번 재시도하도록 해서, 네트워크와 무관한 테스트의 진짜 버그를 가려버리지 않게 했습니다. 재시도가 발생하면 경고를 로그로 남겨서 실제로 어떤 테스트가 플레이키한지 시간이 지나도 계속 볼 수 있게 했습니다.',
          ),
          turn(
            'user',
            'Good — make sure it still fails loudly if all 3 attempts fail.',
            '좋아요 — 3번 다 실패하면 확실하게 실패로 표시되게 해주세요.',
          ),
          turn(
            'assistant',
            'Confirmed — after the 2 retries, a third failure still fails the suite normally, just with a note in the log about the prior attempts.',
            '확인했습니다 — 2번 재시도 후 세 번째도 실패하면 이전 시도들에 대한 로그 기록과 함께 평소대로 스위트가 실패 처리됩니다.',
          ),
        ],
      },
      {
        source: 'kiro',
        daysAgo: 4,
        title: { en: 'Shard the CI test suite by historical run time', ko: '과거 실행 시간 기준으로 CI 테스트 스위트 샤딩' },
        summary: {
          en:
            'Full CI run had grown to 22 minutes, mostly the test suite. Split it into 4 shards balanced by ' +
            'historical run time rather than file count, since checkout/auth specs run much slower than the rest — ' +
            'a naive even split would have overloaded one shard. CI run dropped to about 7 minutes; the flaky-test ' +
            'retry wrapper works unchanged per shard.',
          ko:
            '전체 CI 실행이 22분까지 늘어났고 대부분 테스트 스위트가 원인. 파일 개수가 아닌 과거 실행 시간 기준으로 ' +
            '균형 맞춰 4개 샤드로 분리 — checkout/auth 스펙이 훨씬 느려 단순 균등 분할이면 한 샤드에 부하가 몰렸을 것. ' +
            'CI 실행이 약 7분으로 단축되었고, 플레이키 테스트 재시도 래퍼는 샤드별로 그대로 동작.',
        },
        tags: ['ci', 'performance', 'infra'],
        turns: [
          turn(
            'user',
            'Full CI run is taking 22 minutes now, mostly the test suite. Can we shard it?',
            '전체 CI 실행이 이제 22분이나 걸리는데 대부분 테스트 스위트예요. 샤딩할 수 있을까요?',
          ),
          turn(
            'assistant',
            'Split the suite into 4 shards by file, balanced by historical run time rather than file count — the checkout/auth specs are much slower than the rest, so a naive even split would\'ve left one shard way overloaded. CI run is down to about 7 minutes.',
            '스위트를 파일 개수가 아니라 과거 실행 시간 기준으로 균형 맞춰서 4개 샤드로 나눴습니다 — checkout/auth 스펙이 나머지보다 훨씬 느려서, 단순히 개수로 나누면 한 샤드에 부하가 몰릴 뻔했어요. CI 실행이 약 7분으로 줄었습니다.',
          ),
          turn(
            'user',
            'Nice. Make sure flaky-test retries still work per shard.',
            '좋네요. 샤드별로 플레이키 테스트 재시도가 여전히 잘 동작하는지 확인해주세요.',
          ),
          turn(
            'assistant',
            'Yep, each shard runs its own process so the retry wrapper works exactly the same as before, just now 4 of them in parallel.',
            '네, 각 샤드가 독립된 프로세스로 실행되기 때문에 재시도 래퍼는 이전과 완전히 동일하게 동작하고, 이제 4개가 병렬로 돌 뿐입니다.',
          ),
        ],
      },
    ],
  },

  {
    folder: 'database/read-replica',
    keywords: {
      en: /replica|replication|postgres|failover/i,
      ko: /레플리카|복제|포스트그레스|페일오버/i,
    },
    knowledge: {
      en: `## Read-replica migration

- **Split by write-sensitivity, not blanket routing**: only queries that can tolerate lag (analytics dashboards) move to the replica — writes and anything needing read-your-writes consistency stay on primary.
- **Be honest about lag in the UI**: an 'as of' timestamp on lag-sensitive views beats implying real-time data that might not be.
- **Monitor lag actively**: poll \`pg_stat_replication\` and alert on sustained lag, with a documented runbook (check replica resources first, feature-flag fallback to primary).
- **Reconnect, don't just time out**: a connection pool that keeps serving cached connections to a dead host after failover silently returns stale data — an active health check that closes dead connections is what actually caught this.`,
      ko: `## 리드 레플리카 마이그레이션

- **일괄 라우팅이 아니라 쓰기 민감도로 나눈다**: 지연을 감수할 수 있는 쿼리(분석 대시보드)만 레플리카로 옮긴다 — 쓰기와 read-your-writes 일관성이 필요한 쿼리는 프라이머리에 남긴다.
- **UI에서 지연을 솔직하게 보여준다**: 지연에 민감한 화면에는 실시간처럼 보이는 것보다 '기준 시각' 표시가 낫다.
- **지연을 능동적으로 모니터링한다**: \`pg_stat_replication\`을 폴링하고 지속적인 지연에 알림을 걸며, 런북(레플리카 리소스 먼저 확인, 피처 플래그로 프라이머리 폴백)을 문서화한다.
- **타임아웃만 기다리지 말고 재연결한다**: 페일오버 후에도 죽은 호스트로 캐시된 커넥션을 계속 내주는 풀은 조용히 오래된 데이터를 반환한다 — 죽은 커넥션을 능동적으로 끊는 헬스체크가 실제로 이 문제를 잡아냈다.`,
    },
    sessions: [
      {
        source: 'codex',
        daysAgo: 5,
        title: { en: 'Route analytics queries to the new read replica', ko: '분석 쿼리를 새 리드 레플리카로 라우팅' },
        summary: {
          en:
            'Analytics dashboard queries were adding real load to the primary DB. Added a second connection pool ' +
            'pointed at the newly-provisioned replica and switched analytics queries to use it; writes and ' +
            "read-your-writes-sensitive queries stay on primary. Added an 'as of' timestamp on the dashboard to be " +
            'honest about possible replication lag instead of implying real-time.',
          ko:
            '분석 대시보드 쿼리들이 프라이머리 DB에 실제 부하를 주고 있었음. 새로 프로비저닝한 레플리카를 가리키는 ' +
            '커넥션 풀을 추가해 분석 쿼리를 전환하고, 쓰기와 read-your-writes 민감한 쿼리는 프라이머리 유지. ' +
            "복제 지연 가능성을 솔직히 보여주기 위해 대시보드에 '기준 시각' 표시를 추가.",
        },
        tags: ['database', 'postgres', 'performance'],
        turns: [
          turn(
            'user',
            "Our analytics dashboard queries are adding real load to the primary DB. We provisioned a read replica — can you route those queries there?",
            '분석 대시보드 쿼리들이 프라이머리 DB에 실제로 부하를 주고 있어요. 리드 레플리카를 프로비저닝했는데, 그쪽으로 쿼리를 라우팅해줄 수 있을까요?',
          ),
          turn(
            'assistant',
            "Added a second connection pool pointed at the replica, and switched the analytics service's queries to use it. Everything else (writes, and anything needing read-your-writes consistency) still goes to primary.",
            '레플리카를 가리키는 커넥션 풀을 하나 더 추가하고, 분석 서비스 쿼리들이 그걸 쓰도록 전환했습니다. 그 외(쓰기, read-your-writes 일관성이 필요한 것들)는 여전히 프라이머리로 갑니다.',
          ),
          turn(
            'user',
            'What about replication lag — could the dashboard show stale numbers?',
            '복제 지연은 어떤가요 — 대시보드가 오래된 숫자를 보여줄 수도 있나요?',
          ),
          turn(
            'assistant',
            'Yes, possible, typically well under a second in practice but not guaranteed. Added a small \'as of\' timestamp on the dashboard so it\'s honest about it rather than implying real-time.',
            '네, 가능합니다. 실제로는 보통 1초도 안 걸리지만 보장되진 않아요. 실시간인 것처럼 보이지 않도록 대시보드에 작은 \'기준 시각\' 표시를 추가했습니다.',
          ),
        ],
      },
      {
        source: 'claude',
        daysAgo: 6,
        title: { en: 'Add replication lag monitoring and alerting', ko: '복제 지연 모니터링 및 알림 추가' },
        summary: {
          en:
            'Added a metric polling pg_stat_replication every 30s to report replica lag in seconds, with an alert ' +
            'if it stays over 10s for more than 2 minutes. Documented a runbook: check replica resource usage ' +
            'first, and fall back the analytics service to primary via a feature flag if lag gets bad enough to matter.',
          ko:
            '30초마다 pg_stat_replication을 폴링해 레플리카 지연을 초 단위로 보고하는 메트릭을 추가하고, 10초 초과 ' +
            '상태가 2분 넘게 지속되면 알림이 가도록 설정. 런북을 문서화: 먼저 레플리카 리소스 사용량을 확인하고, ' +
            '지연이 문제될 정도면 피처 플래그로 분석 서비스를 프라이머리로 되돌림.',
        },
        tags: ['database', 'postgres', 'monitoring'],
        turns: [
          turn(
            'user',
            "Let's actually monitor that lag instead of just noting it might happen.",
            '그냥 발생할 수 있다고 적어두기만 하지 말고 실제로 그 지연을 모니터링합시다.',
          ),
          turn(
            'assistant',
            "Added a metric that polls `pg_stat_replication` on the primary every 30s and reports the lag in seconds. Wired up an alert if it exceeds 10s sustained for more than 2 minutes.",
            '프라이머리에서 30초마다 `pg_stat_replication`을 폴링해서 지연 시간을 초 단위로 보고하는 메트릭을 추가했습니다. 10초를 넘는 상태가 2분 넘게 지속되면 알림이 가도록 연결했습니다.',
          ),
          turn(
            'user',
            'Good — what would we actually do if that alert fires?',
            '좋아요 — 근데 그 알림이 울리면 실제로 뭘 해야 하나요?',
          ),
          turn(
            'assistant',
            "Documented a runbook: check replica resource usage first (usually a slow query or IO contention), and as a stopgap the analytics service can fall back to primary via a feature flag if lag gets bad enough to matter.",
            '런북을 문서화했습니다: 먼저 레플리카 리소스 사용량을 확인하고(보통 느린 쿼리나 IO 경합), 지연이 실제로 문제될 정도면 피처 플래그로 분석 서비스를 임시로 프라이머리로 되돌릴 수 있게 했습니다.',
          ),
        ],
      },
      {
        source: 'kiro',
        daysAgo: 7,
        title: { en: 'Fix stale connections after replica failover', ko: '레플리카 페일오버 후 오래된 커넥션 문제 수정' },
        summary: {
          en:
            'During a failover test, dashboard numbers looked wrong for a couple minutes after promotion. Root ' +
            "cause: the connection pool didn't reconnect after the old replica went away, serving cached " +
            'connections to a dead host until they timed out and silently returning stale local results. Added a ' +
            'health check that actively closes dead connections, plus a failover-test assertion that queries ' +
            'succeed with fresh data within 5 seconds of promotion.',
          ko:
            '페일오버 테스트 중 프로모션 이후 몇 분간 대시보드 숫자가 이상했음. 원인은 커넥션 풀이 기존 레플리카가 ' +
            '사라진 뒤 재연결하지 않아 죽은 호스트로 캐시된 커넥션을 타임아웃까지 계속 내주며 조용히 오래된 로컬 ' +
            '결과를 반환한 것. 죽은 커넥션을 능동적으로 끊는 헬스체크를 추가하고, 프로모션 후 5초 안에 최신 데이터로 ' +
            '쿼리가 성공하는지 확인하는 페일오버 테스트 어서션을 추가.',
        },
        tags: ['database', 'postgres', 'reliability'],
        turns: [
          turn(
            'user',
            'During the replica failover test yesterday, a few dashboard numbers looked wrong for a couple minutes after promotion.',
            '어제 레플리카 페일오버 테스트 중에, 프로모션 이후 몇 분 동안 대시보드 숫자 일부가 이상해 보였어요.',
          ),
          turn(
            'assistant',
            "Found it — the connection pool didn't reconnect after the old replica went away, so it kept serving cached connections to a dead host until they timed out, meaning some requests silently fell through to stale local query results instead of erroring properly. Added a health check that actively closes dead connections instead of waiting for them to time out.",
            '원인을 찾았습니다 — 기존 레플리카가 사라진 뒤 커넥션 풀이 재연결하지 않아서, 죽은 호스트에 대한 캐시된 커넥션을 타임아웃될 때까지 계속 내줬습니다. 그래서 일부 요청이 제대로 에러를 내는 대신 조용히 오래된 로컬 쿼리 결과로 빠졌던 거예요. 타임아웃을 기다리는 대신 죽은 커넥션을 능동적으로 끊는 헬스체크를 추가했습니다.',
          ),
          turn(
            'user',
            'Make sure this is covered by the failover test itself, not just a manual check.',
            '수동 확인만 하지 말고 페일오버 테스트 자체에서 이 부분이 커버되게 해주세요.',
          ),
          turn(
            'assistant',
            'Added an assertion to the failover test suite that dashboard queries succeed with fresh data within 5 seconds of a promotion event.',
            '프로모션 이벤트 후 5초 안에 대시보드 쿼리가 최신 데이터로 성공하는지 확인하는 어서션을 페일오버 테스트 스위트에 추가했습니다.',
          ),
        ],
      },
    ],
  },

  {
    folder: 'frontend/react-19-upgrade',
    keywords: {
      en: /react|testing-library|node 18|node 20|dependency|dependencies/i,
      ko: /리액트|react|테스팅\s*라이브러리|node\s*18|node\s*20|의존성/i,
    },
    knowledge: {
      en: `## Dependency upgrades

- **Codemods first, manual cleanup second**: the React 19 codemod handled the bulk of removed legacy APIs; the 6 remaining deprecated-lifecycle class components got their own follow-up ticket instead of blocking the upgrade.
- **Upgrade test tooling alongside the framework**: @testing-library/react needed its own major bump for React 19 — skipping that would have left tests silently mismatched against the new React internals.
- **Warn before you fail**: newly-surfaced act() warnings and a dropped Node version both got a warn-first rollout (CI doesn't fail on them yet) rather than an immediate hard failure, giving time to clean up without blocking everyone else.`,
      ko: `## 의존성 업그레이드

- **코드모드 먼저, 수동 정리는 그다음**: React 19 코드모드가 제거된 레거시 API 대부분을 처리했고, 남은 deprecated 라이프사이클 클래스 컴포넌트 6개는 업그레이드를 막지 않고 별도 후속 티켓으로 분리했다.
- **프레임워크와 함께 테스트 도구도 올린다**: @testing-library/react도 React 19를 위해 메이저 버전을 맞춰 올려야 했다 — 건너뛰었다면 테스트가 새 React 내부 동작과 조용히 어긋났을 것이다.
- **실패시키기 전에 경고부터**: 새로 드러난 act() 경고와 Node 버전 제외 모두 즉시 실패시키는 대신 경고 우선 롤아웃(CI가 아직 실패시키지 않음)으로 처리해, 다른 사람들을 막지 않으면서 정리할 시간을 벌었다.`,
    },
    sessions: [
      {
        source: 'claude',
        daysAgo: 8,
        title: { en: 'Upgrade React 18 to 19', ko: 'React 18에서 19로 업그레이드' },
        summary: {
          en:
            'Bumped react/react-dom to 19 and ran the codemod for removed legacy APIs (mostly propTypes/' +
            'defaultProps on function components). Build is green; 6 older class components in the admin panel ' +
            'use deprecated lifecycle methods that now warn loudly — filed as a separate follow-up ticket rather ' +
            'than blocking this upgrade.',
          ko:
            'react/react-dom을 19로 올리고 제거된 레거시 API(주로 함수 컴포넌트의 propTypes/defaultProps)에 대한 ' +
            '코드모드를 실행. 빌드는 정상이며, 어드민 패널의 오래된 클래스 컴포넌트 6개가 이제 크게 경고하는 ' +
            'deprecated 라이프사이클 메서드를 사용 중 — 이번 업그레이드를 막지 않고 별도 후속 티켓으로 분리.',
        },
        tags: ['frontend', 'react', 'dependencies'],
        turns: [
          turn(
            'user',
            "Time to upgrade React — we're two majors behind now. Can you handle the 18 to 19 bump?",
            '이제 React 업그레이드할 때가 됐어요 — 메이저 버전 2개나 뒤처졌네요. 18에서 19로 올리는 것 좀 처리해줄래요?',
          ),
          turn(
            'assistant',
            "Bumped react/react-dom to 19, ran the codemod for the removed legacy APIs (mostly propTypes/defaultProps on function components). Build's green, but a few of our older class components use deprecated lifecycle methods that now warn loudly — flagging those for a follow-up, not blocking this upgrade.",
            'react/react-dom을 19로 올리고, 제거된 레거시 API들(주로 함수 컴포넌트의 propTypes/defaultProps)에 대한 코드모드를 실행했습니다. 빌드는 정상이지만, 오래된 클래스 컴포넌트 몇 개가 이제 크게 경고를 내는 deprecated 라이프사이클 메서드를 쓰고 있어요 — 이번 업그레이드를 막지는 않되 후속 작업으로 표시해두겠습니다.',
          ),
          turn('user', 'How many components does that touch?', '몇 개 컴포넌트가 영향받나요?'),
          turn(
            'assistant',
            "6 class components across the admin panel, none in the main app. I'll file a separate ticket for migrating those since it's a bigger refactor than this upgrade should carry.",
            '어드민 패널 쪽 클래스 컴포넌트 6개이고, 메인 앱에는 없습니다. 이번 업그레이드가 감당하기엔 더 큰 리팩터링이라 별도 티켓으로 분리해서 마이그레이션하겠습니다.',
          ),
        ],
      },
      {
        source: 'codex',
        daysAgo: 9,
        title: { en: 'Fix component tests broken by the React 19 bump', ko: 'React 19 업그레이드로 깨진 컴포넌트 테스트 수정' },
        summary: {
          en:
            '@testing-library/react needed a matching major bump for React 19 support. After upgrading, act() ' +
            "warnings appeared in ~15 tests that weren't properly awaiting state updates — latent issues the old " +
            'version silently tolerated. Fixed the ones causing real failures; the rest emit warnings for now ' +
            "rather than failing CI, until they're cleaned up.",
          ko:
            '@testing-library/react도 React 19 지원을 위해 메이저 버전을 맞춰 올려야 했음. 업그레이드 후 상태 ' +
            '업데이트를 제대로 기다리지 않던 테스트 약 15개에서 act() 경고 발생 — 예전 버전이 조용히 넘어가주던 ' +
            '잠재 문제. 실제 실패를 일으키는 것들은 고쳤고, 나머지는 정리될 때까지 CI를 실패시키지 않고 경고만 남김.',
        },
        tags: ['frontend', 'testing', 'dependencies'],
        turns: [
          turn(
            'user',
            'A bunch of component tests broke after the React 19 bump — looks like testing-library related.',
            'React 19 업그레이드 후에 컴포넌트 테스트가 여러 개 깨졌어요 — testing-library 관련인 것 같아요.',
          ),
          turn(
            'assistant',
            "@testing-library/react needed a matching major bump for React 19 support. After upgrading it, `act()` warnings appeared in about 15 tests that weren't properly awaiting state updates — those were latent issues the old version silently tolerated. Fixed the ones causing real failures; the rest just emit warnings for now.",
            '@testing-library/react도 React 19를 지원하려면 메이저 버전을 맞춰 올려야 했습니다. 올리고 나니 상태 업데이트를 제대로 기다리지 않던 테스트 약 15개에서 `act()` 경고가 나타났어요 — 예전 버전이 조용히 넘어가주던 잠재적 문제들이었습니다. 실제로 실패를 일으키는 것들은 고쳤고, 나머지는 일단 경고만 냅니다.',
          ),
          turn('user', 'Should we fail CI on those warnings eventually?', '나중엔 그 경고들도 CI 실패로 처리해야 할까요?'),
          turn(
            'assistant',
            "I'd wait until they're all cleaned up first — turning that on now would just be a wall of red for issues that aren't actually breaking anything today.",
            '일단 다 정리한 다음에 하는 게 좋을 것 같아요 — 지금 바로 켜면 실제로는 아무것도 안 망가뜨리는 문제들 때문에 온통 빨간 화면이 될 거예요.',
          ),
        ],
      },
      {
        source: 'kiro',
        daysAgo: 10,
        title: { en: 'Update CI to Node 20/22, drop Node 18', ko: 'CI를 Node 20/22로 업데이트하고 Node 18 제거' },
        summary: {
          en:
            'Node 18 goes EOL soon and CI was still testing against it. Updated the CI matrix to Node 20 and 22, ' +
            "dropped 18, and bumped package.json's engines field to match so a local npm install warns anyone " +
            'still on 18. The only Node-18-specific workaround in the codebase was already dead code from an ' +
            'earlier migration, removed along the way.',
          ko:
            'Node 18 EOL이 임박했는데 CI가 여전히 그 버전으로 테스트 중이었음. CI 매트릭스를 Node 20, 22로 ' +
            '업데이트하고 18은 제외했으며, package.json engines 필드도 맞춰 올려 로컬에서 아직 18을 쓰는 사람에게 ' +
            '경고가 뜨게 함. 코드베이스에 있던 유일한 Node 18 전용 우회 코드는 이미 예전 마이그레이션에서 남은 죽은 코드였기에 함께 제거.',
        },
        tags: ['ci', 'dependencies', 'infra'],
        turns: [
          turn(
            'user',
            "Node 18 goes EOL soon and we're still testing against it in CI. Can you update the matrix?",
            'Node 18 EOL이 곧인데 아직 CI에서 그걸로 테스트하고 있어요. 매트릭스 업데이트해줄 수 있나요?',
          ),
          turn(
            'assistant',
            'Updated the CI matrix to test Node 20 and 22, dropped 18. Also bumped the `engines` field in package.json to match so `npm install` warns anyone still on 18 locally.',
            'CI 매트릭스를 Node 20, 22로 테스트하도록 업데이트하고 18은 제외했습니다. package.json의 `engines` 필드도 맞춰서 올려서, 로컬에서 아직 18을 쓰는 사람에게 `npm install` 시 경고가 뜨게 했습니다.',
          ),
          turn('user', 'Did dropping 18 break anything in the build itself?', '18을 빼면서 빌드 자체가 깨진 부분은 없었나요?'),
          turn(
            'assistant',
            'No — the only Node-18-specific workaround in the codebase was already dead code from an earlier migration, so I removed that too while I was in there.',
            '없었습니다 — 코드베이스에 있던 유일한 Node 18 전용 우회 코드는 이미 예전 마이그레이션에서 남은 죽은 코드였어서, 하는 김에 그것도 같이 제거했습니다.',
          ),
        ],
      },
    ],
  },
];

// Which storyline the pitch video's merge/split beat operates on — same
// meaning as personas.js's own mergeStorylineIndex.
export const PITCH_MERGE_STORYLINE_INDEX = 0;
