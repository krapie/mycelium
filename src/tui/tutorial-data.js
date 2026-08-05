import { randomUUID } from 'node:crypto';
import { emptyNeutral } from '../schema.js';

// Realistic mock sessions for the first-run tutorial / `mycelium demo` — NOT
// real captures. Three storylines (two sessions each) so the o-key step has
// something genuinely worth sorting: a backend timeout bug, a frontend CSS
// bug, and a data-pipeline build-out. Dates are computed relative to "now"
// each time this is called, not hardcoded, so a demo run always looks fresh
// on the calendar. Every session is `demo: true` (tutorial.js's endTutorial()
// sweeps on that) and starts `folder: null` so o has real work to do.

function daysAgo(n, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, Math.floor(Math.random() * 60), 0, 0);
  return d.toISOString();
}

function turn(role, text) {
  return { role, text };
}

const SESSIONS = [
  {
    source: 'claude',
    daysAgo: 6,
    title: '결제 API 타임아웃 원인 조사',
    summary:
      '피크 시간대에 POST /api/payments가 간헐적으로 30초 넘게 걸리다 타임아웃되는 문제를 조사. ' +
      '로그와 커넥션 풀 지표를 확인한 결과, DB 커넥션 풀(pg-pool)의 max가 10으로 너무 낮게 잡혀 있어 ' +
      '동시 요청이 몰릴 때 커넥션 대기열이 쌓이는 것이 원인으로 확인됨.',
    tags: ['백엔드', '결제', '성능', 'PostgreSQL'],
    turns: [
      turn('user', '결제 API가 트래픽 몰릴 때마다 타임아웃이 나는데 원인을 못 찾겠어. 로그부터 같이 봐줄 수 있어?'),
      turn(
        'assistant',
        '로그 확인해보니 POST /api/payments 요청들이 DB 쿼리 시작 전에 대기하는 시간이 길어지는 패턴이 보입니다. ' +
          'pg-pool 설정을 보면 max: 10으로 되어 있는데, 피크 시간대 동시 요청 수(모니터링상 40~50)에 비해 너무 작습니다. ' +
          '커넥션을 다 쓰고 있어서 나머지 요청이 큐에서 기다리다 타임아웃되는 것으로 보입니다.',
      ),
      turn('user', '그럼 max를 늘리면 되는 거야, 아니면 다른 원인도 있을까?'),
      turn(
        'assistant',
        'max를 늘리는 게 1차 조치로 맞습니다. 다만 DB 자체 max_connections도 같이 확인해야 커넥션 풀을 늘렸을 때 DB 쪽에서 거부되지 않습니다. ' +
          '다음 세션에서 실제로 값을 조정하고 부하 테스트로 확인해보시죠.',
      ),
    ],
  },
  {
    source: 'codex',
    daysAgo: 5,
    title: '결제 API 커넥션 풀 설정 수정',
    summary:
      '어제 조사한 타임아웃 문제를 해결하기 위해 pg-pool의 max를 10 → 30으로 늘리고, ' +
      'idleTimeoutMillis를 추가해 유휴 커넥션이 오래 점유되지 않도록 조정. RDS 파라미터 그룹의 ' +
      'max_connections도 100 → 200으로 상향. 부하 테스트에서 p99 응답시간이 4.2초로 개선됨을 확인.',
    tags: ['백엔드', '결제', '성능', 'PostgreSQL'],
    turns: [
      turn('user', '어제 찾은 커넥션 풀 문제, 오늘 바로 고쳐보자. max를 얼마로 잡는 게 좋을까?'),
      turn(
        'assistant',
        '피크 동시 요청이 40~50 수준이었으니 여유를 두고 max: 30으로 설정하고, idleTimeoutMillis: 10000을 추가해 ' +
          '유휴 커넥션을 빨리 반납하도록 했습니다. RDS의 max_connections도 100 → 200으로 올려야 커넥션 풀 확장분을 받아줄 수 있습니다.',
      ),
      turn('user', '적용하고 부하 테스트 돌려봤어. 결과 어때?'),
      turn(
        'assistant',
        'p99 응답시간이 기존 30초 이상(타임아웃)에서 4.2초로 크게 개선됐습니다. 에러율도 12% → 0%로 떨어졌습니다. ' +
          '다음엔 커넥션 풀 지표를 대시보드에 추가해서 재발을 미리 감지하는 걸 추천드립니다.',
      ),
    ],
  },
  {
    source: 'claude',
    daysAgo: 4,
    title: '로그인 페이지 모바일 레이아웃 깨짐 재현',
    summary:
      'iOS Safari(390px 너비)에서 로그인 폼의 비밀번호 입력창과 로그인 버튼이 화면 밖으로 밀려나는 ' +
      '버그를 재현. 원인은 부모 컨테이너에 고정 width(480px)가 박혀 있어 뷰포트보다 좁은 화면에서 ' +
      '가로 스크롤이 생기는 것으로 확인.',
    tags: ['프론트엔드', 'React', 'CSS', '반응형'],
    turns: [
      turn('user', '사용자가 아이폰에서 로그인이 안 된다고 캡처를 보내줬어. 버튼이 화면 밖으로 나가 있어.'),
      turn(
        'assistant',
        'iOS Safari 390px 너비로 재현해봤습니다. `.login-card`에 `width: 480px`가 고정값으로 박혀 있어서, ' +
          '뷰포트보다 넓은 카드가 그대로 렌더링되며 가로 스크롤이 생기고 있습니다. 미디어쿼리가 전혀 없는 상태입니다.',
      ),
      turn('user', '언제부터 이랬던 거지?'),
      turn(
        'assistant',
        '최근 디자인 리뉴얼 커밋에서 `max-width`였던 걸 `width`로 바꾸면서 생긴 것으로 보입니다. ' +
          '다음 세션에서 `max-width` + `width: 100%` 조합과 작은 화면용 패딩 조정으로 고쳐보겠습니다.',
      ),
    ],
  },
  {
    source: 'kiro',
    daysAgo: 3,
    title: '로그인 폼 반응형 CSS 수정',
    summary:
      '.login-card의 width: 480px를 max-width: 480px + width: 100%로 변경하고, 360px 이하 화면에서 ' +
      '패딩과 폰트 크기를 줄이는 미디어쿼리를 추가. 실제 기기(iPhone SE, iPhone 14) 테스트에서 ' +
      '가로 스크롤 없이 정상 렌더링됨을 확인.',
    tags: ['프론트엔드', 'React', 'CSS', '반응형'],
    turns: [
      turn('user', '어제 찾은 원인대로 CSS 고쳐줘. 제일 작은 화면(아이폰 SE)까지 커버해야 해.'),
      turn(
        'assistant',
        '`.login-card`를 `max-width: 480px; width: 100%;`로 바꾸고, `@media (max-width: 360px)`에서 ' +
          '패딩을 24px → 12px, 폰트 크기를 한 단계 줄이는 규칙을 추가했습니다.',
      ),
      turn('user', '아이폰 SE, 아이폰 14 둘 다 테스트해봤는데 이제 깔끔하게 나와. 고마워!'),
      turn('assistant', '확인 감사합니다. 다음에 비슷한 문제 방지하려면 카드류 컴포넌트에 고정 width 대신 max-width를 기본값으로 쓰는 걸 팀 컨벤션으로 정하는 것도 추천드립니다.'),
    ],
  },
  {
    source: 'codex',
    daysAgo: 2,
    title: '일일 매출 리포트 파이프라인 설계',
    summary:
      '매일 아침 전날 매출을 집계해 슬랙으로 요약을 보내는 파이프라인을 설계. pandas로 주문 ' +
      'DB에서 데이터를 읽어 상품별/지역별로 집계하고, 결과를 S3에 parquet으로 적재한 뒤 슬랙 ' +
      'webhook으로 요약을 전송하는 구조로 합의.',
    tags: ['데이터', 'Python', 'pandas', '파이프라인'],
    turns: [
      turn('user', '매일 아침 전날 매출 요약을 슬랙으로 받고 싶어. 어떤 구조로 짜면 좋을까?'),
      turn(
        'assistant',
        '크게 3단계로 나누는 걸 추천드립니다: (1) 주문 DB에서 전날 데이터를 pandas로 읽어 상품별/지역별 집계, ' +
          '(2) 집계 결과를 S3에 parquet으로 적재해 나중에 재분석 가능하게 보관, (3) 슬랙 webhook으로 요약 텍스트 전송. ' +
          '스케줄링은 별도로 잡아야 합니다.',
      ),
      turn('user', '좋은데, 스케줄링은 뭘로 하는 게 좋을까? cron으로 충분할까?'),
      turn('assistant', '재시도·모니터링·의존성 관리까지 고려하면 Airflow가 낫습니다. 다음 세션에서 Airflow DAG로 스케줄링을 붙여보시죠.'),
    ],
  },
  {
    source: 'claude',
    daysAgo: 1,
    title: '매출 리포트 파이프라인 Airflow 스케줄링',
    summary:
      '어제 설계한 매출 집계 스크립트를 Airflow DAG로 감싸 매일 07:00(KST)에 실행되도록 스케줄링. ' +
      '실패 시 3회 재시도 + 슬랙 채널로 실패 알림이 가도록 on_failure_callback을 설정.',
    tags: ['데이터', 'Python', 'pandas', '파이프라인', 'Airflow'],
    turns: [
      turn('user', '어제 짠 집계 스크립트, Airflow DAG로 매일 아침 7시에 돌게 해줘.'),
      turn(
        'assistant',
        '`daily_sales_report` DAG를 만들어 `schedule_interval`을 KST 07:00에 맞춰 cron 표현식으로 설정했습니다. ' +
          'retries=3, retry_delay=5분으로 잡았고, on_failure_callback에서 슬랙 채널로 실패 알림이 가도록 붙였습니다.',
      ),
      turn('user', '테스트 트리거로 한 번 돌려봤는데 슬랙에 리포트 잘 왔어. 실패 알림도 확인해봤어?'),
      turn('assistant', '네, 일부러 DB 커넥션을 끊고 테스트했을 때 3번 재시도 후 슬랙 알림이 정상적으로 도착하는 것까지 확인했습니다.'),
    ],
  },
];

export function buildMockSessions() {
  return SESSIONS.map((s) => {
    const n = emptyNeutral(randomUUID(), s.source);
    n.startedAt = daysAgo(s.daysAgo);
    n.endedAt = daysAgo(s.daysAgo, 11);
    n.turns = s.turns;
    n.extracted.title = s.title;
    n.extracted.summary = s.summary;
    n.extracted.tags = s.tags;
    n.summarizedTurnCount = s.turns.length;
    n.demo = true; // tutorial.js's endTutorial() sweeps on this flag
    return n;
  });
}
