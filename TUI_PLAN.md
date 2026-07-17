# Mycelium TUI — 구현 계획

## 방향 전환

웹 UI를 폐기하고 **터미널 콕핏(k9s for AI work sessions)**으로 전환한다. Mycelium 안에서 살면서, 에이전트를 그 안에서 띄우고, 결과가 자동으로 캡처·정리된다. 개발자는 이미 터미널에 있고 에이전트(Claude Code/Codex)도 터미널 앱이므로, TUI가 웹보다 자연스러운 집이다.

**가장 중요한 변화: Capture가 수동 스캔에서 능동 실행으로 바뀐다.** 폴더에서 "새 세션"을 누르면 에이전트/모델을 고르고, Mycelium이 그 폴더의 조상 경로 컨텍스트를 주입한 뒤 실제 `claude`/`codex`를 포그라운드로 띄운다. 작업 후 종료하면 자동으로 다시 캡처·정리되어 TUI로 복귀한다. k9s에서 파드에 shell 들어갔다 나오는 것과 같은 패턴.

## 기술 결정

- **blessed** (정확히는 유지보수 포크 **neo-blessed**) — 패널/리스트/키바인딩 중심 풀스크린 TUI에 정확히 맞고 빌드 스텝 불필요. ink(JSX/구조화 출력 특화)는 이런 내비게이션엔 어색. 둘 다 MIT → 대회 라이선스 검증 안전.
- **기존 코어 모듈 전부 재사용**: `scanner`, `index-db`, `organize`, `learn`, `insight`, `reuse`, `handoff`는 그대로 둔다. TUI는 같은 코어 위의 새 프론트엔드일 뿐. **제거 대상은 `server.js` + `web/`뿐.**
- 의존성 원칙 완화: 지금까지 zero-dep였으나 TUI 완성도를 위해 blessed 하나만 추가. `node:sqlite` 등 나머지는 그대로 무의존.

## 레이아웃 (k9s 영감)

```
┌ Mycelium ───────────────── 회사/플랫폼/인증 ── 70 sessions ┐
│ breadcrumb · 현재 필터(tag/search) · 카운트                 │
├──────────────┬──────────────────────────────────────────────┤
│ Folders      │ Sessions                                      │
│ (tree)       │  ● claude-code 8f3a #인증 #JWT   회사/…  [사람]│
│  전체         │  ● codex       019a #cli        projects/…    │
│  _inbox      │  ...  (j/k 이동, Enter 상세, Space 다중선택)   │
│  회사/        │                                               │
│   플랫폼/     ├──────────────────────────────────────────────┤
│    인증 ◀     │ Detail: summary · decisions · todos · files   │
│              │        · transcript (스크롤)                   │
├──────────────┴──────────────────────────────────────────────┤
│ <n>new <m>move <t>tag <h>handoff <A>autotag </>search <:>cmd │
└──────────────────────────────────────────────────────────────┘
```

## 뷰 (k9s의 리소스 뷰처럼 `:` 명령 또는 핫키로 전환)

- `:sessions` (기본) — 현재 폴더/태그/검색으로 필터된 세션 리스트 + 상세
- `:folders` — 트리 내비게이션
- `:digests` — 다이제스트 목록 + 리더
- `:knowledge` — 폴더별 KNOWLEDGE.md 뷰어
- `:tags` — 태그 브라우저

## 내비게이션 (k9s 머슬 메모리 그대로)

- `j`/`k` 또는 `↑`/`↓` 이동, `Enter` 드릴인/상세, `Esc` 뒤로
- `/` 라이브 검색/필터, `:` 명령 팔레트
- `g`/`G` 처음/끝, `Tab` 패널 전환, `Space` 다중선택 토글
- `q` 종료, `?` 도움말 오버레이

## 단계별 액션

### Capture — `n` 새 세션 (핵심 신규 기능)

1. `n` → 폴더 선택 (기본 = 현재 폴더)
2. 에이전트 선택: Claude Code / Codex (+ 선택적으로 모델)
3. Mycelium이 그 폴더의 작업 디렉토리 해석:
   - 폴더에 cwd 규칙 있으면 사용
   - 없으면 디렉토리 입력받고 규칙 저장 제안
4. 그 디렉토리의 AGENTS.md에 조상 경로 컨텍스트 주입 (`reuse.injectAgentsMd`)
5. **TUI를 suspend하고** 그 디렉토리에서 `claude`/`codex`를 포그라운드로 spawn (`stdio: inherit`)
6. 종료 시: TUI 복귀 → `scan` → 새 세션 캡처 → 해당 폴더로 자동 배치 → 리스트 갱신
- `s`: 기존 세션 수동 스캔(수동 캡처)도 언제든 가능

### Organize — `m` 이동, `t` 태그 (웹에 없던 수동 조직화)

- `m` (세션 위에서) → 퍼지 폴더 피커 → 이동 (human/sticky 마킹, `organize.move`)
- `t` → 태그 에디터 (추가/삭제, 기존 어휘 자동완성, `organize.tag`)
- `Space`로 다중선택 후 `m`/`t` 일괄 적용
- 드래그앤드롭은 터미널에 없음 → k9s식 "선택 + 액션 키"가 등가물

### Learn — 보기 + 트리거

- `:digests`: 목록, `Enter` 읽기, `D` 특정 일/주 다이제스트 생성(LLM, 진행률 표시)
- `A`: 현재 세션(또는 선택분) 자동 태깅, 결과 태그 인라인 표시
- `:knowledge`: 폴더별 KNOWLEDGE.md, `K`로 현재 폴더 (재)추출

### Reuse — `h` 핸드오프, `c` 컨텍스트, `i` 주입

- `h` (세션 위) → 핸드오프 프롬프트 생성 → 패널 표시, 옵션: 클립보드 복사 / 대상 에이전트를 그 프롬프트로 바로 실행(capture 플로우 재사용, 프롬프트 시드)
- `i` (폴더) → 대상 디렉토리 AGENTS.md에 KNOWLEDGE 주입
- `c` → 조립된 조상 경로 컨텍스트 표시

## 파일 구조

```
src/
  tui/
    app.js            blessed screen, 레이아웃, 뷰 라우터, 전역 키바인딩
    theme.js          foxfire 팔레트 (기존 웹 팔레트 이식)
    views/
      sessions.js     리스트 + 상세
      folders.js      트리
      digests.js      다이제스트 목록 + 리더
      knowledge.js    지식 뷰어
    widgets/
      folderPicker.js 퍼지 폴더 선택
      tagEditor.js    태그 추가/삭제
      agentLauncher.js 에이전트/모델 선택 → 실행
      statusbar.js    하단 키힌트 바
    launch.js         TUI suspend → 포그라운드 에이전트 spawn → resume → capture
  (기존 코어 모듈: scanner, index-db, organize, learn, insight, reuse, handoff — 변경 없음)
cli.js:  인자 없이 `mycelium` (또는 `mycelium tui`) 실행 시 TUI 진입.
         기존 서브커맨드(scan/search/organize/…)는 스크립팅용으로 유지.
제거:    src/server.js, web/
```

## 에이전트 실행 메커니즘 (가장 novel한 부분)

- blessed `screen.leave()` (또는 program pause) → `child_process.spawn(agent, args, { stdio: 'inherit', cwd })` → `child.on('close')`에서 `screen.enter()` + 재렌더
- 실행 전 컨텍스트 주입, 실행 후 캡처 — 이게 Mycelium을 "뷰어"가 아니라 "콕핏"으로 만드는 지점
- Claude Code: `claude`를 인자 없이(인터랙티브) 또는 시드 프롬프트와 함께. Codex: `codex` 인터랙티브
- 터미널 상태 복원(raw mode, alternate screen)이 까다로울 수 있음 → claude/codex 둘 다로 테스트

## 빌드 순서

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| 1 | blessed 추가 + TUI 앱 셸(screen, statusbar, 뷰 라우터, 종료) | 빈 TUI가 뜨고 q로 종료됨 |
| 2 | Sessions 뷰: 리스트(index-db) + 상세 패널 + j/k/Enter + 라이브 `/`검색 | 웹과 읽기 기능 동등 |
| 3 | Folders 뷰: 트리 + 폴더 필터링 | 폴더 선택 시 세션 필터됨 |
| 4 | Organize: `m` 이동(폴더 피커), `t` 태그(에디터), Space 다중선택, sticky | 웹에 없던 수동 조직화가 TUI에서 됨 |
| 5 | Capture/launch: `n` 새 세션(에이전트 선택→컨텍스트 주입→포그라운드 실행→종료 시 캡처) | TUI에서 에이전트 띄워 작업하고 돌아오면 세션이 캡처·정리됨 |
| 6 | Learn: `:digests` 리더 + `D` 생성, `A` 자동태깅, `:knowledge` + `K` | TUI에서 다이제스트/지식 보고 생성 가능 |
| 7 | Reuse: `h` 핸드오프(+시드 실행), `i` 주입, `c` 컨텍스트 | TUI에서 핸드오프·주입 가능 |
| 8 | `server.js`+`web/` 제거, README/help/PROJECT_OVERVIEW 갱신 | 웹 흔적 제거, 문서 일치 |
| 9 | 종단 검증 | 아래 검증 계획 |

2단계까지면 이미 웹 읽기 기능을 대체하고, 5단계에서 "콕핏"이 완성된다.

## 검증 계획

1. 실제 세션 70개로 리스트/검색/폴더 필터/상세 확인 (읽기 동등성)
2. 세션을 TUI에서 폴더 이동 + 태그 편집, `organizedBy: human` sticky 유지 확인
3. `n`으로 Claude Code 세션을 폴더 컨텍스트와 함께 띄우고, 짧은 작업 후 종료 → 새 세션이 자동 캡처·해당 폴더 배치되는지 확인
4. `n`으로 Codex도 동일 확인 (크로스 벤더 실행)
5. `h`로 핸드오프 생성 → 다른 에이전트로 시드 실행되는지 확인
6. `D`/`A`/`K` 트리거가 TUI 안에서 진행률과 함께 동작하는지 확인

## 리스크

- **blessed 유지보수**: neo-blessed 포크 사용 + 버전 고정. 라이선스 MIT → 대회 안전.
- **suspend/resume 터미널 복원**: alternate screen + raw mode 복원이 claude/codex의 자체 TUI와 충돌 가능 → 5단계에서 집중 테스트, 실패 시 `screen.destroy()` 후 재생성 폴백.
- **에이전트 실행 = 실제 쿼터 소비**: "작업 수행" 기능의 본질적 비용, 예상된 것. 데모 시 짧은 태스크로.
- **모델/에이전트 감지**: 설치된 CLI(claude/codex)와 사용 가능 모델 목록을 런타임에 확인해 선택지 구성 (없으면 해당 어댑터 숨김).
