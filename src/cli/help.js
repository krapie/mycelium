import { contentLocale } from '../config.js';

const HELP = {
  en: `Mycelium — context lifecycle for AI collaboration

Capture   scan                          Scan agent session stores → neutral schema (old sessions go to _archive on first capture, the rest start unsorted)
          archive reeval [--days N]     Re-evaluate auto-archive against the current/given threshold (moves New↔_archive). --days also updates the default
Organize  organize [--apply] [--limit N] [--folder <path>]   Suggest folders by content (fills summaries first) — --folder narrows to one folder (and its subfolders), preview only until --apply
          organize --set-limit N        How many sessions one organize run (incl. TUI o) processes (default 30; --limit applies to this run only)
          mkdir <folder>                Create a folder
          mv <session> <folder>         Move a session manually
          tag <session> +t -t           Edit tags manually
          unmerge <session>             Undo a TUI Shift+M merge (restores the original sessions)
          unsplit <session>             Undo a TUI Shift+S split (removes the pieces, restores the original)
Backlog   backlog add "<title>" [--desc D] [--folder F]   Write down work to start later (same as TUI b)
          backlog list [--folder f]                       Backlog items not started yet (or not yet linked to a session)
          backlog open <id|prefix> [--agent a] [--dir D] [--copy]  Print the command that starts a backlog item (to paste in a new tab)
Learn     autotag [<session>] [--force] Content-based auto-tagging (retroactive, in bulk)
          digest [week] [--date D]      Daily/weekly narrative digest
          knowledge [<folder>]          Extract per-folder KNOWLEDGE.md
Reuse     context <session>|--folder    Print ancestor-path context
          inject [--dir D] --folder F   Inject knowledge into AGENTS.md
          handoff <session>             Handoff prompt for another agent
          resume <session|prefix> [--copy|--exec] [--force]  Print the resume command (to paste in a new tab) / copy to clipboard / run now (suggests handoff if the original is gone)
Find      search <q> [--tag t] [--folder f]
          list [--folder f] [--host m] / tags   (_archive hidden by default — list --folder _archive; --host: one machine's sessions on a synced store)
Run       (no args) or tui              Interactive TUI (cockpit) — runs scan/organize/digest on its own while open
          daemon                        (optional) Background upkeep without the TUI (runs in the foreground)
          daemon --detach / --stop      (optional) Keep it running while the TUI is closed — detach / stop (same as scripts/run.sh·stop.sh)
          demo                          Interactive tutorial with fake sessions (separate store, never touches real data) — 3-minute demo
          lang [en|ko]                  Set/show the display language (default en)
Sync      sync host <path>              Create the central repo every machine syncs through (run on the home server/NAS)
          sync init <git-url> [--collect|--two-way] [--worker]  Send this machine's store to that repo (default: one-way, nothing comes back). --collect = the central machine that gathers everyone's sessions; --two-way = also receive what others have. --worker = runs the automatic LLM upkeep (one-way machines always do)
          sync name [<name>]            Show/rename this machine — the @label on its sessions (default: hostname); relabels existing sessions and the remote. sync init takes --name too
          sync mode [push|two-way|collect]  Show/change how this machine syncs
          sync deletes [keep|propagate]  On the collecting machine: keep (default) or delete sessions a pushing machine deleted
          sync [now] / sync status      Sync now (the TUI/daemon also sync every few minutes) / show remote, machine and pending changes
          sync worker [on|off]          Turn automatic LLM upkeep on/off for this machine
          sync map [<from> <to>]        Map another machine's path prefix to this one's (used when continuing its sessions here)
Clean     cleanup [tidy]                Remove meta-sessions + empty folders, rebuild the index
          cleanup folders|archive|index Partial cleanup
          cleanup reset --yes           Wipe all data (~/.mycelium)
Other     --version / -v / -V           Print the installed version
`,
  ko: `Mycelium — AI 협업 컨텍스트 라이프사이클

Capture   scan                          세션 저장소 스캔 → 중립 스키마 (오래된 세션은 첫 캡처 시 _archive로, 나머지는 미분류로 시작)
          archive reeval [--days N]     현재/지정 임계값으로 auto-archive 재평가 (New↔_archive 복구/이동). --days는 기본값도 갱신
Organize  organize [--apply] [--limit N] [--folder <경로>]   내용 기반 폴더 제안(요약 먼저 채움) — --folder로 특정 폴더(하위 포함)만 좁히기, --apply 전엔 미리보기만
          organize --set-limit N        한 번의 정리(TUI o 포함)가 처리할 세션 수 (기본 30, --limit 은 이번 실행만)
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
          resume <session|prefix> [--copy|--exec] [--force]  이어열기 명령어 출력(새 탭 붙여넣기용) / 클립보드 복사 / 즉시 실행 (원본이 없으면 handoff 안내)
Find      search <q> [--tag t] [--folder f]
          list [--folder f] [--host m] / tags  (_archive는 기본 숨김 — list --folder _archive; --host: 동기화된 저장소에서 한 컴퓨터의 세션만)
Run       (인자 없음) 또는 tui          인터랙티브 TUI (콕핏) — 켜져 있는 동안 스캔·정리·다이제스트를 자체적으로 수행
          daemon                        (선택) TUI 없이 백그라운드 업킵만 필요할 때 (포그라운드로 실행)
          daemon --detach / --stop      (선택) TUI가 꺼져 있을 때도 계속 돌리고 싶으면 — 분리 실행 / 정지 (scripts/run.sh·stop.sh와 동일)
          demo                          가짜 세션으로 인터랙티브 튜토리얼 실행(별도 스토어, 실제 데이터 안 건드림) — 3분 데모용
          lang [en|ko]                  표시 언어 설정/확인 (기본 en)
Sync      sync host <path>              모든 컴퓨터가 함께 쓰는 중앙 저장소 생성 (홈 서버/NAS에서 실행)
          sync init <git-url> [--collect|--two-way] [--worker]  이 컴퓨터의 저장소를 그 저장소로 보냄 (기본: 일방향, 받아오는 것 없음). --collect = 모든 컴퓨터의 세션을 모으는 중앙 컴퓨터, --two-way = 다른 컴퓨터의 것도 받음, --worker = 자동 LLM 작업 담당 (일방향 컴퓨터는 항상 직접 함)
          sync name [<이름>]            이 컴퓨터의 이름(세션에 붙는 @표시, 기본: 호스트명) 확인/변경 — 기존 세션과 원격도 같이 바꿈. sync init에도 --name 사용 가능
          sync mode [push|two-way|collect]  이 컴퓨터의 동기화 방식 확인/변경
          sync deletes [keep|propagate]  수집 컴퓨터에서: 보내는 컴퓨터가 지운 세션을 유지(기본)할지 같이 지울지
          sync [now] / sync status      지금 동기화 (TUI·데몬도 몇 분마다 자동 동기화) / 원격·컴퓨터·미동기화 변경 확인
          sync worker [on|off]          이 컴퓨터의 자동 LLM 작업 켜기/끄기
          sync map [<from> <to>]        다른 컴퓨터의 경로 접두사를 이 컴퓨터 경로로 매핑 (그 컴퓨터의 세션을 여기서 이어갈 때 사용)
Clean     cleanup [tidy]                메타세션 제거 + 빈 폴더 정리 + 인덱스 재생성
          cleanup folders|archive|index 부분 정리
          cleanup reset --yes           전체 데이터(~/.mycelium) 초기화
Other     --version / -v / -V           설치된 버전 출력
`,
};

export function printHelp(cmd) {
  console.log(HELP[contentLocale()]);
  // Asking for help is a success; an unknown command is not.
  process.exit(!cmd || ['--help', '-h', 'help'].includes(cmd) ? 0 : 1);
}
