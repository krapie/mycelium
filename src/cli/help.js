export function printHelp(cmd) {
  console.log(`Mycelium — AI 협업 컨텍스트 라이프사이클

Capture   scan                          세션 저장소 스캔 → 중립 스키마 (오래된 세션은 첫 캡처 시 _archive로, 나머지는 미분류로 시작)
          archive reeval [--days N]     현재/지정 임계값으로 auto-archive 재평가 (New↔_archive 복구/이동). --days는 기본값도 갱신
Organize  organize [--apply] [--limit N] [--folder <경로>]   내용 기반 폴더 제안(요약 먼저 채움) — --folder로 특정 폴더(하위 포함)만 좁히기, --apply 전엔 미리보기만
          mkdir <folder>                폴더 생성
          mv <session> <folder>         세션 수동 이동
          tag <session> +t -t           태그 수동 편집
          unmerge <session>              TUI Shift+M 병합 되돌리기 (원본 세션들 복원)
          unsplit <session>              TUI Shift+S 분할 되돌리기 (분할 조각 제거, 원본 복원)
Backlog   backlog add "<제목>" [--desc D] [--folder F]   나중에 할 작업을 미리 적어두기 (TUI b와 동일)
          backlog list [--folder f]                      아직 시작 안 한(또는 세션이 아직 안 잡힌) 백로그 목록
          backlog open <id|prefix> [--agent a] [--dir D] [--copy]  백로그를 시작하는 명령어 출력(새 탭 붙여넣기용)
Learn     autotag [<session>] [--force] 내용 기반 자동 태깅 (소급 일괄)
          digest [week] [--date D]      일일/주간 서사 다이제스트
          knowledge [<folder>]          폴더별 KNOWLEDGE.md 추출
Reuse     context <session>|--folder    조상 경로 컨텍스트 출력
          inject [--dir D] --folder F   AGENTS.md에 지식 주입
          handoff <session>            다른 에이전트용 인수인계 프롬프트
          resume <session|prefix> [--copy|--exec]  이어열기 명령어 출력(새 탭 붙여넣기용) / 클립보드 복사 / 즉시 실행
Find      search <q> [--tag t] [--folder f]
          list [--folder f] / tags     (_archive는 기본 숨김 — list --folder _archive)
Run       (인자 없음) 또는 tui          인터랙티브 TUI (콕핏) — 켜져 있는 동안 스캔·정리·다이제스트를 자체적으로 수행
          daemon                        (선택) TUI 없이 백그라운드 업킵만 필요할 때 (포그라운드로 실행)
          daemon --detach / --stop      (선택) TUI가 꺼져 있을 때도 계속 돌리고 싶으면 — 분리 실행 / 정지 (scripts/run.sh·stop.sh와 동일)
          demo                          가짜 세션으로 인터랙티브 튜토리얼 실행(별도 스토어, 실제 데이터 안 건드림) — 3분 데모용
          lang [en|ko]                  TUI 표시 언어 설정/확인 (기본 en)
Clean     cleanup [tidy]                메타세션 제거 + 빈 폴더 정리 + 인덱스 재생성
          cleanup folders|archive|index 부분 정리
          cleanup reset --yes           전체 데이터(~/.mycelium) 초기화
Other     --version / -v / -V           설치된 버전 출력
`);
  process.exit(cmd ? 1 : 0);
}
