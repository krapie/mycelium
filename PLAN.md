# Mycelium POC — 구현 계획

`PROJECT_OVERVIEW.md`의 라이프사이클 4단계(Capture → Organize → Learn → Reuse)를 전부 실물로 증명하되, 각 단계는 가장 얇은 형태로 만듭니다. 데모에서 보여줘야 하는 건 각 기능의 깊이가 아니라 **순환이 실제로 닫힌다는 것**입니다 — 세션이 자동으로 들어오고, 정리되고, 배운 것이 다음 세션에 실제로 주입되는 것.

---

## POC가 증명해야 하는 사용자 시나리오

1. **가져오기**: 이미 쌓여 있는 Claude Code/Codex 세션 기록을 자동으로 스캔해서 가져온다 (소급 적용 — 처음 설치해도 "이미 정리된 상태"로 시작).
2. **정리**: 기술 티켓/프로젝트/인사 업무처럼 성격이 다른 세션이 폴더와 태그로 나뉘어 보인다. 태그는 사람이 아니라 내용을 읽은 LLM이 붙인다.
3. **탐색**: "몇 주 전 그 티켓" 같은 걸 태그 필터 + 텍스트 검색 조합으로 몇 초 만에 찾는다.
4. **요약**: 어제/이번 주에 무슨 일이 있었는지 서사형 다이제스트로 읽는다.
5. **환류**: 쌓인 세션에서 추출된 컨벤션/결정이 지식 파일로 갱신되고, 새 AI 세션이 그걸 자동으로 물려받는다.
6. **핸드오프**: 진행 중이던 작업을 다른 에이전트가 이어받을 수 있는 프롬프트로 변환한다.

---

## 아키텍처

```
                       ┌──────────────────────────────┐
  ~/.claude/projects/  │           Mycelium            │
  ~/.codex/sessions/ ──┤  ① scanner + adapters         │
  (향후 ~/.kiro/)      │       ↓ 중립 스키마            │
                       │  ② store (파일 = 원본,        │
                       │           sqlite = 파생 인덱스) │
                       │  ③ organize (폴더/태그/상속)   │
                       │  ④ learn (태깅/다이제스트/지식) │
                       │  ⑤ reuse (주입/핸드오프)       │
                       │  daemon + web UI + CLI        │
                       └──────────────────────────────┘
```

### 저장소 설계 — 파일이 원본, DB는 파생물

일반 업무(인사 등)는 git 리포에 묶여 있지 않으므로, Mycelium은 자체 데이터 홈을 가집니다:

```
~/.mycelium/
  tree/                          ← 사용자 폴더 구조 = 실제 디렉토리
    회사/
      플랫폼/인증/JWT/
        KNOWLEDGE.md             ← 이 노드의 지식 (상속의 단위)
        sessions.json            ← 이 노드에 속한 세션 ID 목록
      인사/채용/
        KNOWLEDGE.md
  raw/<session-id>.json          ← 중립 스키마로 정규화된 세션 원본
  digests/
    2026-07-16.md                ← 일일 다이제스트
    2026-W29.md                  ← 주간 다이제스트
  db/index.db                    ← sqlite FTS5 인덱스 (지워도 raw/에서 재생성 가능)
  config.json
```

원칙: **markdown/JSON 파일이 source of truth, sqlite는 언제든 재생성 가능한 검색 인덱스.** (ai-memory가 검증한 패턴 — "위키는 plain markdown, grep 가능, Obsidian으로 열림" + 별도 FTS 인덱스. 도구가 죽어도 데이터는 남습니다.)

### 중립 스키마 (모델 비종속의 핵심)

```json
{
  "id": "...", "source": "claude-code | codex",
  "startedAt": "...", "cwd": "...",
  "turns": [ { "role": "user|assistant", "text": "..." } ],
  "toolActivity": [ "Edit src/auth.ts", "Ran tests (3 passed)" ],
  "artifacts": { "filesChanged": ["src/auth.ts"], "diffSummary": "..." },
  "extracted": { "tags": [], "summary": null, "decisions": [], "todos": [] }
}
```

- 대화 턴은 그대로, 툴 호출은 **산문 요약**으로 — 이 설계는 authsec-bridge가 검증한 NeutralSession 구조(ordered user/assistant turns + prose summaries of tool calls)를 그대로 참조합니다. 툴 호출의 완전한 재현은 어떤 프로젝트도 벤더 간에 성공 못 했고, 필요하지도 않습니다(산출물은 파일시스템/git에 이미 있음).
- `extracted.*`는 Learn 단계가 나중에 채우는 필드 — 캡처와 학습을 분리해서, LLM 없이도 캡처는 항상 동작합니다.

---

## 컴포넌트별 구현 계획 + 참조 오픈소스

각 컴포넌트마다 이 세션에서 직접 조사·검증한 유사 오픈소스에서 **무엇을 빌릴지**를 명시합니다.

### ① Capture — 세션 스캐너 + 어댑터

**방식**: 훅 설치 대신 **파일 스캔** (비침습적). 데몬이 주기적으로 각 CLI의 세션 저장 위치를 폴링해서 새/변경된 세션을 중립 스키마로 변환.

- Claude Code: `~/.claude/projects/` 아래 JSONL 트랜스크립트 (universal-session-viewer가 이 경로를 읽는 것으로 검증됨)
- Codex: 로컬 세션 저장소 (세션 ID 기반, `codex exec resume <id>` 지원 확인됨)
- Kiro: `~/.kiro/` (UUID 세션, JSON export) — POC 이후

**참조**:
- **pi-session-manager** — 다중 CLI(Claude Code/Codex/OpenCode/Gemini/Cursor/Antigravity) 세션 스캔·인덱싱의 선례. 스캔 대상 경로와 포맷 파싱은 이 프로젝트 코드를 직접 참고.
- **universal-session-viewer** — Claude Code JSONL 파싱 + "continuation chain detection"(이어진 세션 감지) 로직 참고.
- **주의(authsec-bridge의 교훈)**: 세션 포맷은 CLI 버전에 민감함(Codex 0.122→0.128에서 스키마 변경으로 깨진 사례). 어댑터는 파싱 실패 시 해당 세션만 건너뛰고 전체가 죽지 않게 설계.

### ② Store — 파일 + sqlite FTS5 인덱스

- `node:sqlite` (Node 22+ 내장, 외부 의존성 0) + FTS5 가상 테이블로 전문검색
- 인덱스 스키마: `sessions(id, source, folder, started_at, summary)`, `session_fts(text)`, `tags(id, name, parent_id)`, `session_tags(session_id, tag_id)`

**참조**: **ai-memory**와 **universal-session-viewer** 둘 다 sqlite FTS5로 세션 전문검색을 구현 — 이 규모(개인, 수천 세션)에서 임베딩 없이 FTS5만으로 충분하다는 선례. ai-memory는 "Zero-LLM 모드에서도 FTS5 검색은 동작"을 명시적 설계 원칙으로 삼는데, POC도 동일 원칙 채택.

### ③ Organize — 폴더 트리 + 계층 태그 + 상속 (자동 + 수동)

조직화는 **자동과 수동의 협업**입니다. 자동(cwd 기반 배치, LLM 태깅)은 기본값을 깔아주는 제안자이고, **최종 결정권은 항상 사람에게** 있습니다:

- 폴더 = `~/.mycelium/tree/` 아래 실제 디렉토리 (mkdir/mv가 곧 조직화 — 별도 UI 없이도 파일 탐색기로 조작 가능)
- 태그 = sqlite `parent_id` 기반 계층 구조, 세션당 다중 태그
- 상속 = 세션이 속한 폴더에서 루트까지 올라가며 각 노드의 `KNOWLEDGE.md`를 수집 (결정론적 — 검색 불필요)

**수동 조직화 (사람의 결정권)**:
- **폴더 CRUD + 세션 이동**: Web UI에서 드래그&드롭으로 세션을 폴더에 배치/이동, 폴더 생성/이름변경/중첩. CLI로도 동일하게 (`mycelium mkdir`, `mycelium mv <세션> <폴더>`)
- **태그 수동 추가/제거**: LLM이 붙인 태그를 사람이 고치거나 지우고, 직접 새 태그를 붙임 (`mycelium tag <세션> +긴급 -오분류`)
- **Inbox 개념**: 자동 배치가 확신 못 하는 세션(cwd 매핑 없음 등)은 `tree/_inbox/`에 두고, 사람이 훑어보며 배치 — "자동이 다 해준다"는 환상 대신, 자동이 90%를 깔고 사람이 10%를 다듬는 흐름
- **사람의 결정은 고정(sticky)**: 사람이 옮긴 세션·고친 태그는 이후 자동 배치/재태깅이 절대 덮어쓰지 않음 (세션별 `organizedBy: human | auto` 마킹). 이게 없으면 사람이 정리한 걸 자동화가 계속 되돌려놓는 최악의 UX가 됨

**참조**:
- **pi-session-manager** — 계층 태그의 구현 선례가 가장 구체적: sqlite `parent_id` 컬럼, `getDescendantIds()` 재귀 조회, 태그+텍스트 결합 SearchFilterBar, 하위 태그 포함 필터링(descendant filtering). **수동 조직화 UX도 이 프로젝트가 선례** — 우클릭 태그 할당, TagPicker 다중 선택, 벌크 태그 조작. 스키마·쿼리 패턴·수동 UX 모두 참고.
- **CLAUDE.md/AGENTS.md의 디렉토리 상속** — 상속 모델 자체의 선례. 다만 이들은 정적 파일이고, Mycelium은 Learn 단계가 이 파일을 **자동 갱신**한다는 게 차이.
- **ai-memory의 `.ai-memory.toml` 마커 파일** — 작업 디렉토리→조직 노드 매핑 방식 참고 (세션의 `cwd`를 보고 어느 폴더에 자동 배치할지 결정하는 규칙).

### ④ Learn — 자동 태깅 + 다이제스트 + 지식 추출

세 가지 배치 작업, 전부 **헤드리스 CLI 호출**(`claude -p` 또는 `codex exec`, 저렴한 모델)로 구현 — 별도 API 키 없이 사용자가 이미 가진 구독을 그대로 사용하고, 공식 CLI의 "일반적인 스크립트화된 사용" 범위 안에 머뭅니다:

1. **자동 태깅**: 새 세션의 중립 스키마(턴 요약)를 넣고 → 태그 후보 + 한 단락 요약 + 결정사항 추출. 기존 태그 목록을 프롬프트에 줘서 태그 어휘가 무한히 발산하지 않게 함. **소급 적용**: 최초 설치 시 과거 세션 전체에 일괄 실행.
2. **일일/주간 다이제스트**: 그 기간의 세션 요약들을 폴더별로 묶어 서사형으로 재요약 → `digests/`에 저장.
3. **지식 추출**: 폴더별로 누적된 요약/결정에서 반복 패턴·컨벤션을 뽑아 해당 노드의 `KNOWLEDGE.md`를 갱신 (전체 재작성이 아니라 마커 블록 내 갱신).

**참조**:
- **ai-memory의 "compile-not-retrieve"** — 원시 로그를 그대로 두지 않고 정합적인 markdown 페이지로 재작성하는 접근, 그리고 통합(consolidation)용 기본 모델로 저렴한 모델(claude-haiku)을 쓰는 선택 모두 참고.
- **memory-journal-mcp의 교훈(반면교사)**: 유일하게 자동 스케줄 다이제스트(`--digest-interval 1440`)를 가졌지만 HTTP 상시 서버 모드에서만 동작 — **스케줄러는 프로바이더가 아니라 자체 데몬이 소유해야 한다**는 근거. Mycelium은 자체 데몬의 setInterval/시각 체크로 구현.
- **내용 기반 자동 태깅은 조사된 프로젝트 중 어디에도 없음** (pi-session-manager의 Auto-Rules는 디렉토리/이름 패턴 매칭뿐) — POC의 가장 선명한 차별점이므로 데모에서 반드시 부각.

### ⑤ Reuse — 컨텍스트 주입 + 핸드오프

- **주입**: 두 경로를 모두 지원
  - (a) **AGENTS.md 마커 블록** — 세션의 작업 디렉토리가 특정 폴더 노드에 매핑되어 있으면, 그 디렉토리의 `AGENTS.md` 안에 `<!-- mycelium:begin -->...<!-- mycelium:end -->` 블록을 유지하며 조상 경로의 KNOWLEDGE.md 내용을 렌더링. **AGENTS.md는 30개 이상 에이전트(Codex, Claude Code, Gemini CLI, Cursor 등)가 네이티브로 읽는 표준**이므로, 에이전트 쪽 수정 없이 "인사이트 → 에이전트 메모리" 환류가 즉시 성립 — 이게 POC에서 자기개선 루프를 실물로 증명하는 가장 값싼 방법.
  - (b) `mycelium context <폴더>` — 조상 경로 컨텍스트를 stdout으로 출력 (아무 도구에나 수동으로 붙여넣기 가능한 범용 탈출구)
- **핸드오프**: `mycelium handoff <세션>` — 중립 스키마에서 "지금까지 한 일(산출물 요약) + 왜(결정) + 다음 할 일(TODO)"을 대상 에이전트용 프롬프트로 렌더링. 원하면 `--to codex` 등으로 대상 CLI를 바로 실행.

**참조**:
- **AGENTS.md 표준** (agents.md) — 주입 매체. "여러 도구가 이미 읽는 파일"을 쓰는 것 자체가 통합 비용을 0으로 만듦.
- **ai-memory의 SessionStart 훅 주입** — "새 세션 시작 시 열린 질문/다음 단계/요약을 프롬프트 앞에 붙임" 구조 참고. 단 POC는 훅 대신 AGENTS.md 경로를 기본으로 (훅은 CLI마다 제각각, AGENTS.md는 공통).
- **authsec-bridge** — 핸드오프 프롬프트의 구성(원 작업 설명, 지금까지의 변경, 마지막 메시지, 이어서 할 일) 참고.

### 데몬 / Web UI / CLI

- **데몬**: 스캔 폴링(1~5분) + 다이제스트 스케줄(매일 1회, 주 1회) — `node:http` + setInterval, 단일 프로세스
- **Web UI**: 빌드 스텝 없는 단일 페이지 (폴더 트리 + 세션 리스트 + 태그 필터 + 검색 + 다이제스트 뷰 + **드래그&드롭 세션 배치, 폴더/태그 편집**). 복잡도가 낮으면 vanilla, 뷰가 4개를 넘으면 Preact+htm CDN import
- **CLI**: `mycelium scan | search | digest | context | handoff | daemon | mkdir | mv | tag`

**스택**: Node.js 22+, 외부 의존성 0 (`node:sqlite`, `node:http`, `node:child_process`, `node:fs`). MIT 라이선스 — 의존성이 없으므로 대회 2차 평가의 라이선스 검증에서 충돌 리스크가 구조적으로 없음.

---

## 빌드 순서

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| 1 | 중립 스키마 + Claude Code 어댑터 + raw/ 저장 | 실제 `~/.claude/projects/`의 과거 세션이 중립 JSON으로 변환됨 |
| 2 | sqlite FTS5 인덱스 + `mycelium search` | 과거 세션에서 키워드 검색이 실제로 물건을 찾음 |
| 3 | 폴더 트리 + 태그 스키마 + cwd 기반 자동 배치 + 수동 조직화(mkdir/mv/tag, Inbox, sticky 규칙) | 세션을 사람이 직접 폴더에 배치·태그 수정할 수 있고, 자동이 사람의 결정을 덮어쓰지 않으며, 태그 필터+검색 결합이 동작 |
| 4 | LLM 자동 태깅 (소급 일괄 실행 포함) | 내용 기반 태그가 실제 과거 세션에 붙고, 사람이 봐도 말이 됨 |
| 5 | 일일/주간 다이제스트 + 데몬 스케줄 | 어제 세션들로 서사형 다이제스트가 자동 생성됨 |
| 6 | KNOWLEDGE.md 추출 + AGENTS.md 마커 블록 주입 | 새 Claude Code/Codex 세션이 추가 설명 없이 프로젝트 컨벤션을 알고 시작함 |
| 7 | `mycelium handoff` | 진행 중 작업이 다른 CLI에서 이어짐 |
| 8 | Web UI | 위 전부를 브라우저에서 탐색 가능 |
| 9 | Codex 어댑터 | 두 번째 소스로 "모델 비종속"이 증명됨 |

2단계가 끝나는 순간부터 이미 쓸모가 있고(검색), 6단계가 끝나면 순환이 닫힙니다. 9단계는 마지막인 이유: 어댑터 인터페이스가 1단계에서 이미 분리되어 있으므로, 두 번째 어댑터는 증명용이지 구조 변경이 아닙니다.

## 검증 계획 (dogfooding)

1. 실제 본인 세션 기록(수 주 분량, 티켓/프로젝트/기타 업무가 섞인 상태)을 소급 임포트
2. 자동 태깅 결과를 훑어보고 오분류율을 체감 수준에서 평가 — 태그 어휘가 발산하는지 확인. 오분류된 세션을 수동으로 옮기고/태그를 고치고, 다음 자동 태깅 실행이 그 수정을 덮어쓰지 않는지(sticky 규칙) 확인
3. "몇 주 전 다뤘던 특정 티켓"을 태그+검색으로 실제로 찾아보기 (이 프로젝트를 시작하게 한 원래 페인 포인트)
4. 하루 일과 후 다이제스트를 읽고, 실제 하루와 맞는지 확인
5. KNOWLEDGE.md가 갱신된 프로젝트에서 새 세션을 열어, 이전 결정("Redis 안 쓰기로 함" 류)을 에이전트가 이미 아는지 확인
6. Claude Code로 시작한 작업을 `mycelium handoff --to codex`로 넘겨 이어지는지 확인

## 데모 시나리오 (3분 영상 구성)

1. (0:00) 뒤섞인 세션 더미 — 검색창 하나로는 못 찾는 상황 제시
2. (0:30) `mycelium scan` — 과거 세션 일괄 임포트 + 자동 태깅되는 화면
3. (1:00) 폴더/태그로 정리된 트리에서 몇 주 전 티켓을 몇 초 만에 찾기
4. (1:30) 일일 다이제스트 — "어제 무슨 일이 있었는지" 서사로 읽기
5. (2:00) KNOWLEDGE.md → AGENTS.md 갱신 → 새 세션이 컨벤션을 이미 알고 시작 (자기개선 루프)
6. (2:30) 쿼터 소진 상황에서 handoff로 다른 에이전트가 이어받기

## 리스크

- **세션 포맷 변동**: CLI 업데이트로 파싱이 깨질 수 있음 (authsec-bridge가 실제로 겪은 문제). 어댑터별 버전 가드 + 실패 세션 스킵으로 완화. 원본 파일은 건드리지 않고 읽기만 하므로 데이터 손상 리스크는 없음.
- **자동 태깅 품질/비용**: 태그 발산은 기존 어휘를 프롬프트에 제공해 완화, 비용은 저렴한 모델 + 세션당 1회 배치라 제한적. 4단계에서 실측 후 프롬프트 조정.
- **민감 정보**: 인사 업무 등 민감한 컨텍스트가 포함되므로 POC는 철저히 로컬 전용(외부 전송 없음, LLM 호출도 사용자 본인의 CLI 구독 경유). 폴더 단위 제외(캡처 안 함) 설정을 config에 포함.
- **AGENTS.md 충돌**: 사용자가 직접 관리하는 내용과 섞이지 않도록 마커 블록 밖은 절대 수정하지 않음.
