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
| `r` | 원래 에이전트에서 그 세션 그대로 **이어열기** (resume) |
| `h` | 다른 에이전트로 컨텍스트 넘겨 **새 세션 시작** (handoff) |
| `n` | 이 폴더 컨텍스트로 새 에이전트 세션 띄우기 |
| `m` / `t` | 폴더 이동 / 태그 편집 |
| `y` | 세션 내용(제목+요약+대화)을 클립보드로 복사 |
| `Space` | 다중 선택 |
| `/` | 전문 검색 |
| `w` / `c` / `i` / `d` | 폴더 지식 추출 / 컨텍스트 보기 / AGENTS.md 주입 / 다이제스트 읽기 (안에서 `n`/`w`로 오늘/이번주 생성) |
| `q` | 종료 |

핸드오프로 이어진 세션은 리스트에 `↩`/`→` 마커와 상세에 "이어받음/이어감" 링크로 표시됩니다.

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
