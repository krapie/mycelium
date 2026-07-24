# Mycelium

AI 협업에서 생성되는 컨텍스트를 **생성(Capture) → 조직화(Organize) → 학습(Learn) → 재사용(Reuse)**까지 관리하는 Context Lifecycle 플랫폼. 모델(Claude Code, Codex 등)·시간·공간의 경계로 컨텍스트가 단절되는 문제를 해결합니다.

개념과 배경은 [`PROJECT_OVERVIEW.md`](./PROJECT_OVERVIEW.md), 설계는 [`PLAN.md`](./PLAN.md) / [`TUI_PLAN.md`](./TUI_PLAN.md) 참고.

## 요구사항

- **Node.js ≥ 22** (내장 `node:sqlite` 사용)
- **git**
- (선택) **`claude` / `codex` / `kiro-cli` CLI** — 설치 및 로그인되어 있으면 요약 생성·이어열기·핸드오프·에이전트 실행에 사용. 단순 탐색/검색만 할 거면 없어도 됩니다.

## 설치

```sh
git clone <this-repo-url> mycelium
cd mycelium
npm install                 # 의존성은 neo-blessed(TUI) 하나뿐
npm link                    # (선택) 전역 `mycelium` 명령 등록
```

## 시작하기

```sh
mycelium scan               # 이 머신의 Claude/Codex/Kiro 세션을 가져오기(임포트)
mycelium                    # 인터랙티브 TUI 실행
```

> 전역 등록(`npm link`)을 안 했으면 `node src/cli.js <명령>` 형태로 실행하세요.

**머신별로 독립적입니다.** Mycelium은 그 컴퓨터의 로컬 세션(`~/.claude/projects/`, `~/.codex/sessions/`, `~/.kiro/sessions/cli/` + kiro-cli의 SQLite DB)만 읽고, 데이터도 그 컴퓨터의 `~/.mycelium/`에 저장합니다. 다른 컴퓨터의 세션이 자동으로 넘어오지 않습니다.

## TUI (콕핏)

`mycelium`을 인자 없이 실행하면 터미널 UI가 뜹니다. **폴더 | 세션 | 상세** 3-컬럼이고, k9s처럼 드릴다운합니다: 폴더에서 시작 → `Enter`로 세션 → `Enter`로 상세 → `Esc`로 뒤로. 포커스한 컬럼이 넓어집니다.

하단 상태바에는 **생성·s → 조직화·m/t/o → 학습·a/w → 재사용·n/h/r** 라이프사이클 바가 항상 떠 있습니다 — 어떤 키가 어느 단계에 속하는지 화면에서 바로 보이는 정적 참고선입니다(지금 어느 단계인지 실시간으로 강조하진 않습니다). 전체 단축키는 아무 화면에서나 **`?`**를 누르면 뜨는 도움말 모달에서 확인하세요.

**표시 언어는 기본 영어**입니다. `mycelium lang ko`로 한국어로 바꿀 수 있고(다음 TUI 실행부터 적용), `mycelium lang en`으로 되돌릴 수 있습니다. TUI 안에서 바로 전환하는 키는 없습니다 — 실행 전에 CLI로 설정하는 방식입니다.

**폴더 패널**

맨 위 **`Root`**는 트리의 최상위(고정, 이름변경/이동/삭제 불가)이고, 사용자가 만든 실제 폴더들은 그 아래 한 단 들여써서 표시됩니다. `_inbox` 같은 별도 폴더는 없습니다 — **`Root`는 아직 어느 폴더에도 배정되지 않은 세션만 보여줍니다** (이미 폴더에 들어간 세션은 그 폴더에서만 보이고 `Root`에는 안 뜸 — 문자 그대로 트리 최상위). 제목/요약 옆에는 **`[New]`** 표시가 붙습니다 — `m`으로 원하는 폴더로 옮기면 그 폴더로 옮겨가고 `Root`에서는 사라집니다. `/` 검색은 예외로, `Root`에서 검색해도 이미 폴더에 정리된 세션까지 전체 대상으로 찾아줍니다(실제 폴더 안에서 검색하면 그 폴더로 범위가 좁혀짐).

| 키 | 동작 |
|---|---|
| `a` | 새 (하위)폴더 |
| `e` / `m` / `x` | 이름변경 / 이동·중첩 / 삭제 |
| `w` | 폴더 지식(KNOWLEDGE.md) 추출 |
| `Enter` | 이 폴더의 세션 보기 |

**`_archive` 폴더는 TUI에 기본적으로 안 보입니다** — 폴더 목록, `Root` 뷰, 검색 결과 어디에도 안 뜹니다. 죽은 cwd 세션이 자동 정리 시(`autoOrganize`/`mycelium organize`) 여기로 모이고, `m`으로 아무 세션이나 `_archive`에 직접 옮겨도 됩니다 — 눈에 안 띄는 보관함입니다. 데이터는 그대로 있고 지워지지 않으니, 나중에 확인하려면:
```sh
mycelium list --folder _archive
mycelium search "검색어" --folder _archive
```
한 번 `_archive`로 옮긴 세션은(수동이든 자동이든) 재스캔해도 다시 튀어나오지 않습니다 — `scan()`은 이미 배정된 폴더를 그대로 유지하고, TUI의 `s`는 스캔만 할 뿐 폴더를 재배정하지 않습니다.

**세션 패널**
| 키 | 동작 |
|---|---|
| `a` | 내용 기반 요약·태그 생성 (LLM, 여러 개는 `Space` 후 일괄). **제목이 이미 있으면 제목은 건드리지 않고**, 요약·태그·결정·할일은 매번 최신 내용으로 다시 씁니다 |
| `e` | **제목만** 작은 모달로 수정 (Mycelium 저장소만 수정 — 원본 claude/codex/kiro 세션 로그는 건드리지 않음). 요약·태그·결정·할일은 항상 AI 생성 그대로이며 이 키로는 건드리지 않습니다. 여기서 정한 제목은 이후 `a`를 다시 눌러도 유지됩니다 |
| `r` | 원래 에이전트에서 그 세션 그대로 **이어열기** (resume, 바로 여기서). 상세 화면에서는 `r` 대신 `Enter` — "여기서 열기" 또는 "명령어 복사"(새 탭 붙여넣기용) 중 선택 |
| `o` | **스마트 정리** — 아직 폴더 없는 세션을 요약한 뒤, 이미 정리된 폴더들의 내용과 비교해 폴더를 제안. 제안 목록에서 `Space`로 원하는 것만 골라 `Enter`로 적용(체크 안 한 건 그대로 둠), `Esc`로 전체 취소 |
| `h` | 다른 에이전트로 컨텍스트 넘겨 **새 세션 시작** (handoff) |
| `n` | 이 폴더 컨텍스트로 새 에이전트 세션 띄우기 |
| `m` / `t` | 폴더 이동 / 태그 편집 |
| `x` | 세션 삭제 (Mycelium 저장소에서만 — 원본 로그는 그대로 두고, 다시 스캔해도 재캡처되지 않도록 삭제 목록에 기록) |
| `y` | 세션 내용(제목+요약+대화)을 클립보드로 복사 |
| `Space` | 다중 선택 |
| `/` | 전문 검색 |
| `s` | **스캔**을 TUI에서 바로 (`mycelium scan`과 동일 — 여러 탭/터미널에서 켜둔 세션을 CLI 없이 그대로 불러옴). cwd 규칙 기반 자동배치는 아직 CLI 전용 — `mycelium organize`. 내용 기반 스마트 정리는 위 `o` 참고 |
| `w` / `c` / `i` / `d` | 폴더 지식 추출(미리보기 후 확인) / 컨텍스트 보기 / AGENTS.md 주입(미리보기 후 확인) / 다이제스트 읽기 (안에서 `n`/`w`로 오늘/이번주 생성) |
| `q` | 종료 |

핸드오프로 이어진 세션은 리스트에 `↩`/`→` 마커와 상세에 "이어받음/이어감" 링크로 표시됩니다.

## Desktop (실험 단계, `desktop` 브랜치)

TUI는 자신이 떠 있는 터미널 밖으로 나갈 수 없어서(탭을 직접 못 열고, 세션도
요약+이어열기 명령만 보여줄 수 있음) 진짜 데스크톱 앱을 별도로 만들고
있습니다 — Electron + `node-pty` + `xterm.js` (VS Code 통합 터미널과 같은
조합). 세션을 클릭하면 요약을 거치지 않고 바로 새 탭에 실제 라이브
터미널로 열립니다. 기존 백엔드(`scanner`/`organize`/`learn`/`daemon`/
`agents` 등)는 전혀 안 건드리고 그대로 재사용합니다 — `neo-blessed` 의존이
없는 순수 로직이라 새 프론트엔드를 얹기만 하면 됩니다. 아직 `main`에는
없고 `desktop` 브랜치에만 있습니다; CLI/TUI는 영향 없이 그대로 동작합니다.
자세한 설계는 `desktop.md` 참고.

**실행 방법**:
```sh
git checkout desktop
cd desktop
npm install
npx electron-rebuild -f -w node-pty   # node-pty를 Node용이 아니라 Electron ABI에 맞게 재빌드 — 필수
npm start                             # 또는: node_modules/.bin/electron .
```

왼쪽 사이드바에 실제 `~/.mycelium` 폴더/세션이 뜨고, 세션을 클릭하면 바로
새 탭에 라이브 터미널로 열립니다. 탭 상단 `+`로 새 세션(에이전트 선택 →
작업 디렉토리 입력 — 아직 OS `prompt()` 팝업, 제대로 된 모달은 다음
단계). 탭 닫기(×)는 프로세스를 종료하고 세션을 재캡처합니다.

## 학습·재사용 루프 (세션이 끝난 뒤 다음 세션에 반영되기)

Mycelium이 "자동으로 좋아진다"는 건 Claude Code의 `/write`, `/proofread` 같은
**스킬 자체를 고친다는 뜻이 아닙니다** — 스킬 정의는 Mycelium이 전혀 건드리지
않습니다. Mycelium이 실제로 갱신하는 건 그 위에 얹히는 **폴더별 컨텍스트**
(`KNOWLEDGE.md` → `AGENTS.md`)입니다: 지난 세션에서 확정된 규칙·표현·구조를
다음 세션이 시작할 때부터 이미 알고 있게 만드는 것.

**예시 — 사건(케이스) 처리로 서신 작성**

1. **Capture** — `사건/OO` 폴더 작업 디렉토리에서 세션을 열고 `/write`로
   서신 초안을 작성, `/proofread`로 다듬습니다. 세션은 실시간으로 캡처되고
   있으니 이 단계에서 따로 할 일은 없습니다.
2. 초안을 손으로 더 다듬어 최종본을 만듭니다. **이 최종본이나 "무엇을
   바꿨는지"가 세션 안에 텍스트로 남아 있어야** 다음 단계에서 학습됩니다 —
   Mycelium은 세션 밖(이메일 클라이언트 등)에서 벌어진 수작업은 볼 수
   없습니다. 최종본을 세션에 붙여넣거나, 세션을 마치기 전에 "이렇게
   고쳤고 이유는 이거다" 한 줄을 남기세요.
3. **Organize** — 세션이 처음이면 `m`으로 `사건/OO` 폴더에 배정합니다
   (이후 같은 작업 디렉토리의 세션은 규칙에 따라 자동 배정됩니다).
4. **Learn**
   - `a` — 세션을 요약·태깅합니다. 손질 규칙을 결정(decision)으로 뽑아
     내려면, 세션을 마치기 전에 "이번에 확정한 문서 작성 규칙을 정리해줘"
     한 번 물어보세요 — `a`가 그 답을 `decisions`로 구조화해 담습니다.
     `a`는 다시 돌릴 때마다 요약·태그·결정·할일을 최신 내용으로 갱신하니
     세션이 더 진행됐으면 언제든 다시 눌러도 됩니다. 제목만은 한 번
     정해지면(`a`가 처음 붙였든 `e`로 직접 적었든) 계속 유지됩니다 — 자동
     추출된 제목이 마음에 안 들면 `e`로 고쳐 쓰세요.
   - `w` — **폴더(`사건/OO`) 지식을 추출**합니다. 그 폴더의 모든 세션의
     요약·결정을 모아 `KNOWLEDGE.md`로 컴파일합니다 — 이번 케이스뿐 아니라
     그 폴더의 과거 케이스들까지 함께 반영됩니다.
5. **Reuse** — 다음에 같은 폴더에서 새 세션을 열면(`n`/`h`/`r`), Mycelium이
   그 시점의 `KNOWLEDGE.md`를 작업 디렉토리의 `AGENTS.md`에 자동
   주입합니다. Claude Code/Codex/Kiro는 세션을 시작하자마자 이 폴더에서 확정된
   규칙을 이미 알고 있는 상태가 됩니다 — `/write`나 `/proofread`는 그대로
   쓰더라도, 그 위에 깔리는 배경 지식이 갱신돼 있으니 결과물이 달라집니다.

**어디까지 자동인가:**

| 단계 | `mycelium daemon` 실행 중 | 안 켜놨을 때 |
|---|---|---|
| Capture (스캔) | 5분마다 자동 | 수동 — `mycelium scan` 또는 TUI에서 `s` (TUI는 진입 시 자동 스캔하지 않음) |
| Organize (cwd 규칙 자동 배정) | 자동 (사람이 정리한 세션은 보존) | 수동 — `mycelium organize` (CLI 전용, TUI `s`는 스캔만 함) |
| Organize: 스마트 정리 (`o`) | 30분마다 자동 계산 후 **대기열에 큐잉**(기본은 적용까지는 안 함) | `o` 또는 `mycelium organize --smart` 수동 |
| Learn: 요약·태깅 (`a`) | 새로 들어온 세션에 자동 실행 | `a` 또는 `mycelium autotag` 수동 |
| Learn: 폴더 지식 (`w`) | **자동 아님** | `w` 또는 `mycelium knowledge <폴더>` 수동 |
| Reuse: AGENTS.md 주입 | `n`/`h`로 띄운 세션엔 항상 자동 | 동일 — 데몬 여부와 무관 |

**스마트 정리(`o`)는 데몬이 켜져 있어도 자동으로 "적용"까지는 안 합니다** — cwd 규칙
자동배정과 달리 LLM 추측이라 오분류 위험이 있어서, `w`/`i`와 같은 원칙(쓰기 전에
항상 사람이 미리보기)을 따릅니다. 데몬은 30분마다(환경변수
`MYCELIUM_SMART_ORGANIZE_MS`로 조절, 한 사이클당 최대 `MYCELIUM_SMART_ORGANIZE_LIMIT`개,
기본 100개) 미분류 세션을 요약·분류해서 세션 자체에 제안을 큐잉해 둡니다. 다음에
TUI를 열면 "N개 정리 제안 대기 중 — o로 확인" 알림이 뜨고, `o`를 누르면 **다시
계산하지 않고** 바로 그 제안을 다중 선택 화면으로 보여줍니다 — 원하는 것만 체크해서
`Enter`로 적용, 나머지는 그냥 대기열에서 빠집니다(다시 안 나타남). `Esc`로 전체
취소하면 큐는 그대로 남아 다음에 또 뜹니다. 검토 없이 데몬이 바로 옮기게 하려면
`~/.mycelium/config.json`의 `autoApproveSmartOrganize`를 `true`로 바꾸세요(기본 `false`).

**"자동"은 `n`/`h`로 띄운 세션에 한합니다.** 터미널에서 그냥 `claude`/`codex`/`kiro-cli`를
직접 치거나 스크립트로 여는 세션은 Mycelium을 거치지 않으므로 이 주입 트리거가
걸리지 않습니다 — `AGENTS.md`는 그냥 디스크의 파일이라, 예전에 한 번이라도
주입된 적이 있으면 그 스냅샷은 계속 읽히지만 **그 이후 `KNOWLEDGE.md`가 갱신된
내용은 자동으로 안 따라갑니다.** Mycelium 밖에서 여는 세션에도 최신 지식을
넣고 싶으면 그 직전에 TUI `i` 키 또는
```sh
mycelium inject --dir <프로젝트 경로> --folder <폴더>   # --folder 생략 시 cwd 규칙으로 자동 판단
```
를 실행하세요. Capture(스캔)·Learn(요약·태깅)은 세션을 어떻게 열었는지와 무관하게
항상 적용됩니다 — 오직 이 "AGENTS.md 새로고침" 단계만 실행 경로를 탑니다.

`w`(폴더 지식 추출)만 사람이 직접 눌러야 하는 지점입니다 — 의도적으로
그렇게 두었습니다: 무엇이 "이 폴더에서 확정된 규칙"인지는 사람이 그 시점의
세션들을 보고 판단하는 편이, 세션이 들어올 때마다 자동으로 `KNOWLEDGE.md`를
다시 쓰는 것보다 안전합니다. 데몬의 스캔 주기에 `w`까지 자동으로 끼워 넣는
것도 가능하니, 원하면 요청하세요.

**TUI의 `w`/`i`는 쓰기 전에 항상 미리보기를 보여주고 확인을 받습니다.**
LLM이 생성한 `KNOWLEDGE.md` 내용이나 `AGENTS.md`에 주입될 내용을 스크롤
가능한 창으로 먼저 보여주고, `y`/`Enter`로 저장하거나 `n`/`Esc`로 취소할 수
있습니다 — 한 번 `KNOWLEDGE.md`에 들어가면 그 폴더의 모든 미래 세션에
자동으로 주입되기 때문에, 저장 전에 사람이 실제로 훑어보는 지점을 하나
만들어 둔 것입니다. (CLI의 `mycelium knowledge <폴더>`는 확인할 사람이
없는 비대화형 호출이라 예전처럼 바로 씁니다.) 다만 `n`/`h`로 에이전트를
띄울 때 자동으로 일어나는 `AGENTS.md` 주입 자체는 이미 저장된
`KNOWLEDGE.md`를 그대로 반영하는 것이라 확인 없이 계속 자동으로
진행됩니다 — 확인은 그 `KNOWLEDGE.md`가 저장되는 `w` 시점에서 이미
끝난 것으로 봅니다.

## 핸드오프 라이프사이클 (모델 간 이어가기)

Claude Code, Codex, Kiro는 세션을 서로 다른 포맷으로 저장하기 때문에, 벤더를 바꾸는
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
mycelium organize --smart [--apply]            # 내용 기반 폴더 제안(요약 먼저 채움, --apply 전엔 미리보기만)
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
mycelium resume <session|prefix> [--copy|--exec] # 이어열기 명령어 출력/클립보드 복사/즉시 실행
mycelium search "쿼터" --tag 인프라 --folder 회사
mycelium list / tags / reindex

# 백그라운드 업키핑 (주기 스캔 + 일일 다이제스트 + 스마트 정리 큐잉, UI 없음)
mycelium daemon

# TUI 표시 언어 (기본 en) — 다음 TUI 실행부터 적용
mycelium lang        # 현재 설정 확인
mycelium lang ko      # 한국어로 전환
mycelium lang en      # 영어로 전환
```

**`mycelium`(TUI)을 그냥 평소처럼 열면 백그라운드 데몬이 자동으로 같이 켜집니다** —
따로 `mycelium daemon`이나 스크립트를 실행할 필요 없습니다. TUI가 시작할 때
`~/.mycelium/daemon.pid`를 확인해서, 이미 떠 있으면 아무 일 안 하고, 없으면 detached로
하나 띄웁니다 — **TUI를 닫아도 데몬은 계속 삽니다**(그래서 다음에 열 때 이미 정리돼
있는 것처럼 보임). 이 자동 시작이 싫으면 `MYCELIUM_NO_AUTOSTART=1` 환경변수로 끌 수
있습니다.

수동으로 직접 제어하고 싶을 때(예: TUI를 한 번도 안 열고 헤드리스로만 쓰는 경우):
```sh
scripts/run.sh    # 이미 떠 있으면 아무 일 안 함(idempotent), 로그는 ~/.mycelium/daemon.log
scripts/stop.sh    # 떠 있으면 정지, 없으면 아무 일 안 함
```
둘 다 TUI 자동 시작과 같은 `~/.mycelium/daemon.pid`를 쓰므로, 어느 쪽으로 띄웠든
`scripts/stop.sh`로 멈출 수 있습니다. 재부팅 시 자동 시작 같은 건 없습니다 — 필요하면
`scripts/run.sh`를 launchd/systemd/cron 등에 걸어 쓰세요.

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
- **`archive`**는 죽은 cwd 세션을 스토어에서 지웁니다. 원본 `~/.claude`/`~/.codex`/`~/.kiro` 로그는 그대로라, 다시 `scan`하면 재유입됩니다(단 자동으로 다시 `_archive`로 감).
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
  config.json            cwd→폴더 규칙, 삭제 목록, 표시 언어(locale) 등
```

머신 간에 세션을 옮기려면 `raw/`와 `tree/`를 복사한 뒤 대상에서 `mycelium reindex`.

## 설계 원칙

- **로컬 전용**: 세션에는 민감한 업무가 포함되므로 외부 전송 없음. 인터페이스는 로컬 터미널 TUI, LLM 호출도 사용자 본인의 CLI 구독 경유.
- **모델 비종속**: 저장 포맷이 특정 벤더 세션 형식이 아닌 중립 스키마. 새 에이전트 추가 = 어댑터 한 파일.
- **사람 우선**: 자동 배치/태깅은 제안일 뿐, 사람이 정리한 세션(`organizedBy: human`)은 자동화가 덮어쓰지 않음.
- **의존성 최소**: 코어는 Node 내장 모듈(`node:sqlite` 등)만, TUI만 `neo-blessed`(MIT) 하나. MIT 라이선스.

## 상태

POC. 라이프사이클 4단계 전부 실제 로컬 세션(Claude Code + Codex + Kiro)으로 동작 검증. TUI는 neo-blessed 기반이며 실제 터미널에서 사용 검증 중.
