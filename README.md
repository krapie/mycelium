# Mycelium

AI 협업에서 생성되는 컨텍스트를 **생성(Capture) → 조직화(Organize) → 학습(Learn) → 재사용(Reuse)**까지 관리하는 Context Lifecycle 플랫폼. 모델(Claude Code, Codex 등)·시간·공간의 경계로 컨텍스트가 단절되는 문제를 해결합니다.

개념과 배경은 [`PROJECT_OVERVIEW.md`](./PROJECT_OVERVIEW.md), 설계는 [`PLAN.md`](./PLAN.md) / [`TUI_PLAN.md`](./TUI_PLAN.md) 참고.

## 요구사항

- **Node.js ≥ 22** (내장 `node:sqlite` 사용)
- **git**
- (선택) **`claude` / `codex` CLI** — 설치 및 로그인되어 있으면 요약 생성·이어열기·핸드오프·에이전트 실행에 사용. 단순 탐색/검색만 할 거면 없어도 됩니다.

## 설치

```sh
git clone <this-repo-url> mycelium
cd mycelium
npm install                 # 의존성은 neo-blessed(TUI) 하나뿐
npm link                    # (선택) 전역 `mycelium` 명령 등록
```

## 시작하기

```sh
mycelium scan               # 이 머신의 Claude/Codex 세션을 가져오기(임포트)
mycelium                    # 인터랙티브 TUI 실행
```

> 전역 등록(`npm link`)을 안 했으면 `node src/cli.js <명령>` 형태로 실행하세요.

**머신별로 독립적입니다.** Mycelium은 그 컴퓨터의 로컬 세션(`~/.claude/projects/`, `~/.codex/sessions/`)만 읽고, 데이터도 그 컴퓨터의 `~/.mycelium/`에 저장합니다. 다른 컴퓨터의 세션이 자동으로 넘어오지 않습니다.

## TUI (콕핏)

`mycelium`을 인자 없이 실행하면 터미널 UI가 뜹니다. **폴더 | 세션 | 상세** 3-컬럼이고, k9s처럼 드릴다운합니다: 폴더에서 시작 → `Enter`로 세션 → `Enter`로 상세 → `Esc`로 뒤로. 포커스한 컬럼이 넓어집니다.

**폴더 패널**
| 키 | 동작 |
|---|---|
| `a` | 새 (하위)폴더 |
| `e` / `m` / `x` | 이름변경 / 이동·중첩 / 삭제 |
| `w` | 폴더 지식(KNOWLEDGE.md) 추출 |
| `Enter` | 이 폴더의 세션 보기 |

**세션 패널**
| 키 | 동작 |
|---|---|
| `a` | 내용 기반 요약·태그 생성 (LLM, 여러 개는 `Space` 후 일괄) |
| `e` | 제목·요약을 `$EDITOR`로 직접 편집 (Mycelium 저장소만 수정 — 원본 claude/codex 세션 로그는 건드리지 않음). 이후 `a`를 다시 눌러도 태그·결정·할일만 갱신되고 이 편집은 유지됨 |
| `r` | 원래 에이전트에서 그 세션 그대로 **이어열기** (resume) |
| `h` | 다른 에이전트로 컨텍스트 넘겨 **새 세션 시작** (handoff) |
| `n` | 이 폴더 컨텍스트로 새 에이전트 세션 띄우기 |
| `m` / `t` | 폴더 이동 / 태그 편집 |
| `x` | 세션 삭제 (Mycelium 저장소에서만 — 원본 로그는 그대로 두고, 다시 스캔해도 재캡처되지 않도록 삭제 목록에 기록) |
| `y` | 세션 내용(제목+요약+대화)을 클립보드로 복사 |
| `Space` | 다중 선택 |
| `/` | 전문 검색 |
| `w` / `c` / `i` / `d` | 폴더 지식 추출 / 컨텍스트 보기 / AGENTS.md 주입 / 다이제스트 읽기 (안에서 `n`/`w`로 오늘/이번주 생성) |
| `q` | 종료 |

핸드오프로 이어진 세션은 리스트에 `↩`/`→` 마커와 상세에 "이어받음/이어감" 링크로 표시됩니다.

## 핸드오프 라이프사이클 (모델 간 이어가기)

Claude Code와 Codex는 세션을 서로 다른 포맷으로 저장하기 때문에, 벤더를 바꾸는
핸드오프(`h`)는 항상 **새 세션**을 만듭니다 — 버그가 아니라 의도된 동작입니다.
같은 에이전트로 그대로 이어가려면 `r`(이어열기/resume)을 쓰세요: `r`은 원래
세션 자체를 이어가고(같은 에이전트에서만 가능), `h`는 다른 에이전트로(필요하면
원래 에이전트로 되돌아가도) 항상 새 세션을 엽니다.

```
Claude 세션 A ──h(핸드오프)──▶ Codex 세션 B ──h(핸드오프)──▶ Claude 세션 C
   (완료, 보존됨)                 (완료, 보존됨)                  (진행 중)
```

여러 번 왕복해도 세션은 계속 갈라지지만, 두 가지 방법으로 "수렴"됩니다:

1. **체인 연결** — 각 홉은 `continuationOf`/`continuedTo`로 양방향 연결되어
   리스트에 `↩`/`→` 마커, 상세 화면에 "이어받음/이어감" 링크로 보입니다.
   끊어진 세션들이 아니라 하나의 흐름으로 추적됩니다.
2. **폴더 지식으로 합류** — 실제로 "합쳐지는" 지점은 개별 세션 파일이 아니라
   그 폴더의 `KNOWLEDGE.md`입니다. `w`를 누르면 그 폴더의 모든 세션(에이전트
   상관없이)의 요약·결정을 하나의 문서로 컴파일하고, 이 문서는 다음에 그
   폴더에서 에이전트를 띄울 때(`n`/`h`/`r`) `AGENTS.md`에 자동 주입됩니다.

**되돌아가는 핸드오프(B→C) 전 권장 순서:**
1. `a` — 넘겨줄 세션(B)에 아직 요약이 없다면 먼저 생성하세요. 핸드오프
   프롬프트가 `extracted.summary`/`decisions`/`todos`를 그대로 담기 때문에,
   없으면 첫/마지막 메시지 원문만으로 부실한 핸드오프가 됩니다.
2. `w` — 폴더 지식을 최신화하세요. 다음 에이전트 시작 시 주입되는
   `AGENTS.md`가 이 시점의 `KNOWLEDGE.md`를 반영합니다.
3. `h` — B에서 핸드오프, 에이전트로 원하는 쪽(Claude Code 등)을 선택합니다.

**이전 세션(A)은 어떻게 되나요?** 방치되는 게 아니라 "완료된 채 보존"됩니다:
- 원본 `.jsonl` 로그는 그대로 남아 있고, 언제든 `r`로 그 시점 그대로 다시 열
  수 있습니다.
- A가 만든 코드/파일 변경은 이미 디스크(레포)에 있으므로, 대화 스레드가
  옮겨가도 작업 결과물은 사라지지 않습니다.
- A의 요약·결정은 이미 Mycelium에 저장돼 있고, `w`로 폴더 지식에 반영됩니다.
- 다만 A는 "그 시점에서 멈춘 가지"가 됩니다 — 이후 진행은 C(또는 다음 이어
  열기)에서 계속해야 하며, A를 나중에 다시 열어 타이핑해도 C에서 있었던
  변경 사항은 알지 못합니다.

## CLI (스크립팅용)

TUI 없이 개별 명령으로도 전부 됩니다:

```sh
# Capture / Organize
mycelium scan
mycelium organize                              # cwd 기반 자동 배치(사람 정리분 보존)
mycelium mkdir 회사/플랫폼/인증
mycelium mv <session> 회사/플랫폼/인증
mycelium tag <session> +긴급 -오분류
mycelium rule /path/to/repo projects/relay     # cwd→폴더 규칙

# Learn
mycelium autotag                               # 과거 세션 소급 일괄 요약·태깅
mycelium digest [week] [--date YYYY-MM-DD]
mycelium knowledge 회사/플랫폼/인증

# Reuse / Find
mycelium context <session>
mycelium inject --dir <프로젝트> --folder <폴더> # AGENTS.md에 지식 주입
mycelium handoff <session>                     # 인수인계 프롬프트 출력
mycelium search "쿼터" --tag 인프라 --folder 회사
mycelium list / tags / reindex

# 백그라운드 업키핑 (주기 스캔 + 일일 다이제스트, UI 없음)
mycelium daemon
```

## 정리 (실험 단계)

아직 실험 단계라 테스트하다 보면 세션/폴더가 지저분해질 수 있습니다. `cleanup`으로 정리합니다:

```sh
mycelium cleanup            # (= tidy) 안전 정리: Mycelium 자체 LLM 호출 세션 제거
                            #  + 빈 폴더 제거 + 인덱스 재생성. 수시로 돌려도 됨.
mycelium cleanup folders    # 빈 폴더만 제거
mycelium cleanup archive    # _archive(원본 디렉토리가 사라진 세션)를 스토어에서 삭제
mycelium cleanup index      # sqlite 인덱스만 재생성 (검색이 이상할 때)
mycelium cleanup reset --yes # 전체 초기화: ~/.mycelium 통째로 삭제 → 다시 scan
```

- **`tidy`(기본)와 `folders`/`index`는 안전**합니다 — 원본 세션(`raw/`)을 지우지 않습니다.
- **`archive`**는 죽은 cwd 세션을 스토어에서 지웁니다. 원본 `~/.claude`/`~/.codex` 로그는 그대로라, 다시 `scan`하면 재유입됩니다(단 자동으로 다시 `_archive`로 감).
- **`reset --yes`는 되돌릴 수 없습니다** — `~/.mycelium`(정규화 세션·폴더·지식·인덱스)를 전부 삭제합니다. 그래도 원본 에이전트 세션 로그는 안 건드리므로, `mycelium scan`으로 처음부터 다시 만들 수 있습니다.

깨끗하게 새로 시작하려면: `mycelium cleanup reset --yes && mycelium scan`.

## 데이터 위치

모든 데이터는 `~/.mycelium/`에 로컬 저장. **파일이 원본, sqlite는 파생 인덱스**(지워도 `mycelium reindex`로 재생성):

```
~/.mycelium/
  raw/<id>.json          중립 스키마로 정규화된 세션 (source of truth)
  tree/<폴더>/           사용자 폴더 구조 = 실제 디렉토리
    KNOWLEDGE.md         폴더별 프로젝트 지식 (상속 단위)
  digests/YYYY-Wnn.md    서사형 다이제스트
  db/index.db            sqlite FTS5 검색 인덱스 (재생성 가능)
  config.json            cwd→폴더 규칙 등
```

머신 간에 세션을 옮기려면 `raw/`와 `tree/`를 복사한 뒤 대상에서 `mycelium reindex`.

## 설계 원칙

- **로컬 전용**: 세션에는 민감한 업무가 포함되므로 외부 전송 없음. 인터페이스는 로컬 터미널 TUI, LLM 호출도 사용자 본인의 CLI 구독 경유.
- **모델 비종속**: 저장 포맷이 특정 벤더 세션 형식이 아닌 중립 스키마. 새 에이전트 추가 = 어댑터 한 파일.
- **사람 우선**: 자동 배치/태깅은 제안일 뿐, 사람이 정리한 세션(`organizedBy: human`)은 자동화가 덮어쓰지 않음.
- **의존성 최소**: 코어는 Node 내장 모듈(`node:sqlite` 등)만, TUI만 `neo-blessed`(MIT) 하나. MIT 라이선스.

## 상태

POC. 라이프사이클 4단계 전부 실제 로컬 세션(Claude Code + Codex)으로 동작 검증. TUI는 neo-blessed 기반이며 실제 터미널에서 사용 검증 중.
