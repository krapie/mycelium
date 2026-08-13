// Bilingual (en/ko) mock session content for the flagship pitch video
// (demo/tapes/pitch-en.tape, pitch-ko.tape) — NOT shipped, NOT part of
// personas.js/the real interactive tutorial. Twelve sessions across four
// SWE-flavored topics, deliberately left WITHOUT a pre-filled
// extracted.title/summary (unlike tutorial-data.js's buildMockSessions(),
// which pre-fills both) — see seed-pitch-demo.js's comment for why: this
// video wants the real, full summarize-then-classify pipeline to run on
// camera, not the tutorial's shortcut past it.
//
// Same per-field bilingual shape personas.js uses: `folder` is a single
// shared ASCII/kebab-case value in both languages (real project folder
// names stay English even for Korean-speaking teams — see AGENTS.md);
// `turns` is `{role, en, ko}` per turn, resolved by language at seed time.

export const PITCH_SESSIONS = [
  // ── Auth token refresh ──
  {
    source: 'codex',
    daysAgo: 1,
    turns: [
      {
        role: 'user',
        en: "We're seeing intermittent 401s in production, seems to spike right around the 1-hour mark. Can you check if it's a token expiry issue?",
        ko: '프로덕션에서 간헐적으로 401이 발생하는데, 1시간 지점 근처에서 몰리는 것 같아요. 토큰 만료 문제인지 확인해줄래요?',
      },
      {
        role: 'assistant',
        en: "Looked at the auth middleware — refresh tokens are valid for 1h but there's no proactive refresh, so any request landing exactly at expiry gets a hard 401 instead of a silent refresh. I'll add a check that refreshes if the token expires within the next 60 seconds.",
        ko: '인증 미들웨어를 확인했습니다 — 리프레시 토큰은 1시간 동안 유효한데 선제적 갱신이 없어서, 만료 시점에 정확히 걸리는 요청은 조용히 갱신되는 대신 401을 그대로 받습니다. 만료까지 60초 이내로 남으면 미리 갱신하는 체크를 추가하겠습니다.',
      },
      {
        role: 'user',
        en: 'That should cover it. Add a test for the boundary case.',
        ko: '그 정도면 될 것 같아요. 경계 케이스 테스트도 추가해주세요.',
      },
      {
        role: 'assistant',
        en: 'Added a test that mocks a token expiring in 30s and confirms the client refreshes before the request goes out, plus a control test for a token with plenty of time left.',
        ko: '30초 뒤 만료되는 토큰을 모킹해서 요청 전에 클라이언트가 갱신하는지 확인하는 테스트를 추가했고, 여유 시간이 충분한 토큰에 대한 대조 테스트도 함께 추가했습니다.',
      },
    ],
  },
  {
    source: 'claude',
    daysAgo: 2,
    turns: [
      {
        role: 'user',
        en: "The refresh endpoint itself sometimes 503s under load. Right now a failed refresh just fails the whole request.",
        ko: '리프레시 엔드포인트 자체가 부하가 있을 때 503을 낼 때가 있어요. 지금은 리프레시가 실패하면 요청 전체가 그냥 실패해버려요.',
      },
      {
        role: 'assistant',
        en: "Added exponential backoff (3 attempts, 200ms/400ms/800ms) around the refresh call specifically — not the original request, since that's already been decided and shouldn't be retried blindly. If all 3 attempts fail we still surface the original 401, just later.",
        ko: '리프레시 호출에만 지수 백오프(3회, 200ms/400ms/800ms)를 추가했습니다 — 원래 요청은 이미 결정된 상태라 무작정 재시도하면 안 되니 대상에서 뺐어요. 3번 다 실패하면 원래의 401을 그대로 보여주되, 시점만 조금 늦춰집니다.',
      },
      {
        role: 'user',
        en: 'Good, and log each retry attempt so we can see it in the dashboards.',
        ko: '좋아요, 각 재시도를 로그로 남겨서 대시보드에서 볼 수 있게 해주세요.',
      },
      {
        role: 'assistant',
        en: 'Done — each retry attempt logs the attempt number and delay, tagged so it\'s filterable separately from normal auth failures.',
        ko: '완료했습니다 — 각 재시도마다 시도 횟수와 지연 시간을 로그로 남기고, 일반 인증 실패와 별도로 필터링할 수 있게 태그를 붙였습니다.',
      },
    ],
  },
  {
    source: 'kiro',
    daysAgo: 2,
    turns: [
      {
        role: 'user',
        en: 'Two requests firing at almost the same time near token expiry — I think they might both trigger a refresh independently.',
        ko: '토큰 만료 시점 근처에서 요청 두 개가 거의 동시에 나가면, 둘 다 각자 리프레시를 트리거할 것 같아요.',
      },
      {
        role: 'assistant',
        en: "Confirmed it — there's no lock around the refresh call, so two concurrent requests near expiry both kick off their own refresh, and the second one silently overwrites the first token in the cache. Added a single in-flight refresh promise that concurrent callers await instead of starting their own.",
        ko: '확인했습니다 — 리프레시 호출에 락이 없어서, 만료 근처의 동시 요청 두 개가 각자 리프레시를 시작하고 두 번째 것이 캐시의 첫 번째 토큰을 조용히 덮어씁니다. 동시 호출자들이 각자 새로 시작하는 대신 기다릴 수 있는 단일 진행 중 리프레시 프로미스를 추가했습니다.',
      },
      {
        role: 'user',
        en: 'Add a test that actually exercises the race, not just unit-tests the lock.',
        ko: '락만 단위 테스트하지 말고, 실제로 레이스 상황을 재현하는 테스트도 추가해주세요.',
      },
      {
        role: 'assistant',
        en: 'Wrote an integration test that fires 5 concurrent requests right at the expiry boundary and asserts exactly one refresh call was made to the auth server.',
        ko: '만료 경계 시점에 동시 요청 5개를 날리고 인증 서버로 리프레시 호출이 정확히 한 번만 갔는지 확인하는 통합 테스트를 작성했습니다.',
      },
    ],
  },

  // ── CI pipeline flakiness ──
  {
    source: 'claude',
    daysAgo: 3,
    turns: [
      {
        role: 'user',
        en: "checkout.spec.ts fails about 1 in 10 runs on CI but never locally. Can you dig in?",
        ko: 'checkout.spec.ts가 CI에서 10번 중 1번꼴로 실패하는데 로컬에서는 한 번도 안 그래요. 좀 파봐줄래요?',
      },
      {
        role: 'assistant',
        en: "It's a timing issue — the test clicks 'Place Order' and immediately asserts the confirmation page, but the order-confirmation call is async and CI's just slower under load than our machines. Added an explicit wait for the confirmation element instead of assuming it's already there.",
        ko: '타이밍 문제였습니다 — 테스트가 \'주문하기\'를 클릭하고 바로 확인 페이지를 검증하는데, 주문 확인 호출이 비동기라 CI가 부하 상태에서 우리 로컬 머신보다 느립니다. 확인 요소가 이미 있다고 가정하는 대신 명시적으로 기다리도록 추가했습니다.',
      },
      {
        role: 'user',
        en: 'Any chance this affects other specs with the same pattern?',
        ko: '같은 패턴을 쓰는 다른 스펙들도 영향받을 가능성이 있을까요?',
      },
      {
        role: 'assistant',
        en: 'Grepped for the same immediate-assert-after-click pattern — found 2 more specs doing it (refund flow, address update). Fixed all three the same way.',
        ko: '클릭 직후 바로 검증하는 같은 패턴을 grep으로 찾아봤더니 2개가 더 있었습니다(환불 플로우, 주소 변경). 셋 다 같은 방식으로 고쳤습니다.',
      },
    ],
  },
  {
    source: 'codex',
    daysAgo: 4,
    turns: [
      {
        role: 'user',
        en: 'Rather than fixing each flaky test one by one, can we add a general retry mechanism for tests that hit real network calls?',
        ko: '플레이키 테스트를 하나씩 고치는 대신, 실제 네트워크 호출을 하는 테스트들을 위한 범용 재시도 메커니즘을 추가할 수 있을까요?',
      },
      {
        role: 'assistant',
        en: "Added a `retryFlaky()` wrapper — retries up to 2 times ONLY for tests explicitly tagged `@flaky-network`, so it doesn't mask genuine bugs in tests that aren't network-dependent. Logs a warning on any retry so we can still see which tests are actually flaky over time.",
        ko: '`retryFlaky()` 래퍼를 추가했습니다 — `@flaky-network` 태그가 명시적으로 붙은 테스트에 한해서만 최대 2번 재시도하도록 해서, 네트워크와 무관한 테스트의 진짜 버그를 가려버리지 않게 했습니다. 재시도가 발생하면 경고를 로그로 남겨서 실제로 어떤 테스트가 플레이키한지 시간이 지나도 계속 볼 수 있게 했습니다.',
      },
      {
        role: 'user',
        en: 'Good — make sure it still fails loudly if all 3 attempts fail.',
        ko: '좋아요 — 3번 다 실패하면 확실하게 실패로 표시되게 해주세요.',
      },
      {
        role: 'assistant',
        en: 'Confirmed — after the 2 retries, a third failure still fails the suite normally, just with a note in the log about the prior attempts.',
        ko: '확인했습니다 — 2번 재시도 후 세 번째도 실패하면 이전 시도들에 대한 로그 기록과 함께 평소대로 스위트가 실패 처리됩니다.',
      },
    ],
  },
  {
    source: 'kiro',
    daysAgo: 4,
    turns: [
      {
        role: 'user',
        en: 'Full CI run is taking 22 minutes now, mostly the test suite. Can we shard it?',
        ko: '전체 CI 실행이 이제 22분이나 걸리는데 대부분 테스트 스위트예요. 샤딩할 수 있을까요?',
      },
      {
        role: 'assistant',
        en: 'Split the suite into 4 shards by file, balanced by historical run time rather than file count — the checkout/auth specs are much slower than the rest, so a naive even split would\'ve left one shard way overloaded. CI run is down to about 7 minutes.',
        ko: '스위트를 파일 개수가 아니라 과거 실행 시간 기준으로 균형 맞춰서 4개 샤드로 나눴습니다 — checkout/auth 스펙이 나머지보다 훨씬 느려서, 단순히 개수로 나누면 한 샤드에 부하가 몰릴 뻔했어요. CI 실행이 약 7분으로 줄었습니다.',
      },
      {
        role: 'user',
        en: 'Nice. Make sure flaky-test retries still work per shard.',
        ko: '좋네요. 샤드별로 플레이키 테스트 재시도가 여전히 잘 동작하는지 확인해주세요.',
      },
      {
        role: 'assistant',
        en: 'Yep, each shard runs its own process so the retry wrapper works exactly the same as before, just now 4 of them in parallel.',
        ko: '네, 각 샤드가 독립된 프로세스로 실행되기 때문에 재시도 래퍼는 이전과 완전히 동일하게 동작하고, 이제 4개가 병렬로 돌 뿐입니다.',
      },
    ],
  },

  // ── Postgres read-replica migration ──
  {
    source: 'codex',
    daysAgo: 5,
    turns: [
      {
        role: 'user',
        en: "Our analytics dashboard queries are adding real load to the primary DB. We provisioned a read replica — can you route those queries there?",
        ko: '분석 대시보드 쿼리들이 프라이머리 DB에 실제로 부하를 주고 있어요. 리드 레플리카를 프로비저닝했는데, 그쪽으로 쿼리를 라우팅해줄 수 있을까요?',
      },
      {
        role: 'assistant',
        en: "Added a second connection pool pointed at the replica, and switched the analytics service's queries to use it. Everything else (writes, and anything needing read-your-writes consistency) still goes to primary.",
        ko: '레플리카를 가리키는 커넥션 풀을 하나 더 추가하고, 분석 서비스 쿼리들이 그걸 쓰도록 전환했습니다. 그 외(쓰기, read-your-writes 일관성이 필요한 것들)는 여전히 프라이머리로 갑니다.',
      },
      {
        role: 'user',
        en: 'What about replication lag — could the dashboard show stale numbers?',
        ko: '복제 지연은 어떤가요 — 대시보드가 오래된 숫자를 보여줄 수도 있나요?',
      },
      {
        role: 'assistant',
        en: 'Yes, possible, typically well under a second in practice but not guaranteed. Added a small \'as of\' timestamp on the dashboard so it\'s honest about it rather than implying real-time.',
        ko: '네, 가능합니다. 실제로는 보통 1초도 안 걸리지만 보장되진 않아요. 실시간인 것처럼 보이지 않도록 대시보드에 작은 \'기준 시각\' 표시를 추가했습니다.',
      },
    ],
  },
  {
    source: 'claude',
    daysAgo: 6,
    turns: [
      {
        role: 'user',
        en: "Let's actually monitor that lag instead of just noting it might happen.",
        ko: '그냥 발생할 수 있다고 적어두기만 하지 말고 실제로 그 지연을 모니터링합시다.',
      },
      {
        role: 'assistant',
        en: "Added a metric that polls `pg_stat_replication` on the primary every 30s and reports the lag in seconds. Wired up an alert if it exceeds 10s sustained for more than 2 minutes.",
        ko: '프라이머리에서 30초마다 `pg_stat_replication`을 폴링해서 지연 시간을 초 단위로 보고하는 메트릭을 추가했습니다. 10초를 넘는 상태가 2분 넘게 지속되면 알림이 가도록 연결했습니다.',
      },
      {
        role: 'user',
        en: 'Good — what would we actually do if that alert fires?',
        ko: '좋아요 — 근데 그 알림이 울리면 실제로 뭘 해야 하나요?',
      },
      {
        role: 'assistant',
        en: "Documented a runbook: check replica resource usage first (usually a slow query or IO contention), and as a stopgap the analytics service can fall back to primary via a feature flag if lag gets bad enough to matter.",
        ko: '런북을 문서화했습니다: 먼저 레플리카 리소스 사용량을 확인하고(보통 느린 쿼리나 IO 경합), 지연이 실제로 문제될 정도면 피처 플래그로 분석 서비스를 임시로 프라이머리로 되돌릴 수 있게 했습니다.',
      },
    ],
  },
  {
    source: 'kiro',
    daysAgo: 7,
    turns: [
      {
        role: 'user',
        en: 'During the replica failover test yesterday, a few dashboard numbers looked wrong for a couple minutes after promotion.',
        ko: '어제 레플리카 페일오버 테스트 중에, 프로모션 이후 몇 분 동안 대시보드 숫자 일부가 이상해 보였어요.',
      },
      {
        role: 'assistant',
        en: "Found it — the connection pool didn't reconnect after the old replica went away, so it kept serving cached connections to a dead host until they timed out, meaning some requests silently fell through to stale local query results instead of erroring properly. Added a health check that actively closes dead connections instead of waiting for them to time out.",
        ko: '원인을 찾았습니다 — 기존 레플리카가 사라진 뒤 커넥션 풀이 재연결하지 않아서, 죽은 호스트에 대한 캐시된 커넥션을 타임아웃될 때까지 계속 내줬습니다. 그래서 일부 요청이 제대로 에러를 내는 대신 조용히 오래된 로컬 쿼리 결과로 빠졌던 거예요. 타임아웃을 기다리는 대신 죽은 커넥션을 능동적으로 끊는 헬스체크를 추가했습니다.',
      },
      {
        role: 'user',
        en: 'Make sure this is covered by the failover test itself, not just a manual check.',
        ko: '수동 확인만 하지 말고 페일오버 테스트 자체에서 이 부분이 커버되게 해주세요.',
      },
      {
        role: 'assistant',
        en: 'Added an assertion to the failover test suite that dashboard queries succeed with fresh data within 5 seconds of a promotion event.',
        ko: '프로모션 이벤트 후 5초 안에 대시보드 쿼리가 최신 데이터로 성공하는지 확인하는 어서션을 페일오버 테스트 스위트에 추가했습니다.',
      },
    ],
  },

  // ── Dependency upgrade ──
  {
    source: 'claude',
    daysAgo: 8,
    turns: [
      {
        role: 'user',
        en: "Time to upgrade React — we're two majors behind now. Can you handle the 18 to 19 bump?",
        ko: '이제 React 업그레이드할 때가 됐어요 — 메이저 버전 2개나 뒤처졌네요. 18에서 19로 올리는 것 좀 처리해줄래요?',
      },
      {
        role: 'assistant',
        en: "Bumped react/react-dom to 19, ran the codemod for the removed legacy APIs (mostly propTypes/defaultProps on function components). Build's green, but a few of our older class components use deprecated lifecycle methods that now warn loudly — flagging those for a follow-up, not blocking this upgrade.",
        ko: 'react/react-dom을 19로 올리고, 제거된 레거시 API들(주로 함수 컴포넌트의 propTypes/defaultProps)에 대한 코드모드를 실행했습니다. 빌드는 정상이지만, 오래된 클래스 컴포넌트 몇 개가 이제 크게 경고를 내는 deprecated 라이프사이클 메서드를 쓰고 있어요 — 이번 업그레이드를 막지는 않되 후속 작업으로 표시해두겠습니다.',
      },
      {
        role: 'user',
        en: 'How many components does that touch?',
        ko: '몇 개 컴포넌트가 영향받나요?',
      },
      {
        role: 'assistant',
        en: "6 class components across the admin panel, none in the main app. I'll file a separate ticket for migrating those since it's a bigger refactor than this upgrade should carry.",
        ko: '어드민 패널 쪽 클래스 컴포넌트 6개이고, 메인 앱에는 없습니다. 이번 업그레이드가 감당하기엔 더 큰 리팩터링이라 별도 티켓으로 분리해서 마이그레이션하겠습니다.',
      },
    ],
  },
  {
    source: 'codex',
    daysAgo: 9,
    turns: [
      {
        role: 'user',
        en: 'A bunch of component tests broke after the React 19 bump — looks like testing-library related.',
        ko: 'React 19 업그레이드 후에 컴포넌트 테스트가 여러 개 깨졌어요 — testing-library 관련인 것 같아요.',
      },
      {
        role: 'assistant',
        en: "@testing-library/react needed a matching major bump for React 19 support. After upgrading it, `act()` warnings appeared in about 15 tests that weren't properly awaiting state updates — those were latent issues the old version silently tolerated. Fixed the ones causing real failures; the rest just emit warnings for now.",
        ko: '@testing-library/react도 React 19를 지원하려면 메이저 버전을 맞춰 올려야 했습니다. 올리고 나니 상태 업데이트를 제대로 기다리지 않던 테스트 약 15개에서 `act()` 경고가 나타났어요 — 예전 버전이 조용히 넘어가주던 잠재적 문제들이었습니다. 실제로 실패를 일으키는 것들은 고쳤고, 나머지는 일단 경고만 냅니다.',
      },
      {
        role: 'user',
        en: 'Should we fail CI on those warnings eventually?',
        ko: '나중엔 그 경고들도 CI 실패로 처리해야 할까요?',
      },
      {
        role: 'assistant',
        en: "I'd wait until they're all cleaned up first — turning that on now would just be a wall of red for issues that aren't actually breaking anything today.",
        ko: '일단 다 정리한 다음에 하는 게 좋을 것 같아요 — 지금 바로 켜면 실제로는 아무것도 안 망가뜨리는 문제들 때문에 온통 빨간 화면이 될 거예요.',
      },
    ],
  },
  {
    source: 'kiro',
    daysAgo: 10,
    turns: [
      {
        role: 'user',
        en: "Node 18 goes EOL soon and we're still testing against it in CI. Can you update the matrix?",
        ko: 'Node 18 EOL이 곧인데 아직 CI에서 그걸로 테스트하고 있어요. 매트릭스 업데이트해줄 수 있나요?',
      },
      {
        role: 'assistant',
        en: 'Updated the CI matrix to test Node 20 and 22, dropped 18. Also bumped the `engines` field in package.json to match so `npm install` warns anyone still on 18 locally.',
        ko: 'CI 매트릭스를 Node 20, 22로 테스트하도록 업데이트하고 18은 제외했습니다. package.json의 `engines` 필드도 맞춰서 올려서, 로컬에서 아직 18을 쓰는 사람에게 `npm install` 시 경고가 뜨게 했습니다.',
      },
      {
        role: 'user',
        en: 'Did dropping 18 break anything in the build itself?',
        ko: '18을 빼면서 빌드 자체가 깨진 부분은 없었나요?',
      },
      {
        role: 'assistant',
        en: 'No — the only Node-18-specific workaround in the codebase was already dead code from an earlier migration, so I removed that too while I was in there.',
        ko: '없었습니다 — 코드베이스에 있던 유일한 Node 18 전용 우회 코드는 이미 예전 마이그레이션에서 남은 죽은 코드였어서, 하는 김에 그것도 같이 제거했습니다.',
      },
    ],
  },
];
