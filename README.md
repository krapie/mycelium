# Mycelium

AI 협업에서 생성되는 컨텍스트를 **생성 → 조직화 → 학습 → 재사용**까지 관리하는 Context Lifecycle 플랫폼.

모델(Claude Code, Codex 등), 시간, 공간의 경계로 컨텍스트가 단절되는 문제를 해결합니다. 개념과 배경은 [`PROJECT_OVERVIEW.md`](./PROJECT_OVERVIEW.md), 설계는 [`PLAN.md`](./PLAN.md) 참고.

## 요구사항

- Node.js ≥ 22 (내장 `node:sqlite` 사용, 외부 의존성 0)
- Claude Code / Codex CLI (세션 소스이자, 학습 단계의 LLM 호출에 사용)

## 라이프사이클 명령어

```sh
# ① Capture — 세션 저장소를 스캔해 모델 비종속 중립 스키마로 가져오기
mycelium scan

# ② Organize — cwd 기반 자동 배치(사람이 정리한 건 보존) + 수동 조작
mycelium organize
mycelium mkdir 회사/플랫폼/인증
mycelium mv <session> 회사/플랫폼/인증
mycelium tag <session> +긴급 -오분류
mycelium rule /Users/me/work/relay projects/relay   # cwd→폴더 규칙

# ③ Learn — 내용 기반 자동 태깅, 서사형 다이제스트, 폴더 지식 추출
mycelium autotag                # 과거 세션 소급 일괄 태깅
mycelium digest [week]          # 일일/주간 다이제스트
mycelium knowledge 회사/플랫폼/인증   # KNOWLEDGE.md 추출

# ④ Reuse — 조상 경로 컨텍스트 주입 + 인수인계
mycelium context <session>      # 이 세션이 상속하는 컨텍스트
mycelium inject --dir <프로젝트> # AGENTS.md에 지식 주입 (자기개선 루프)
mycelium handoff <session>      # 다른 에이전트용 인수인계 프롬프트

# 탐색
mycelium search "쿼터" --tag 인프라 --folder 회사
mycelium list / tags

# 인터랙티브 TUI (콕핏) — 인자 없이 실행
mycelium                        # k9s식 터미널 UI
#   </>검색 <n>새세션 <m>이동 <t>태그 <A>태깅
#   <h>핸드오프 <D>다이제스트 <c>컨텍스트 <i>주입 <K>지식 <q>종료

# 백그라운드 업키핑 (스캔 폴링 + 다이제스트 스케줄, UI 없음)
mycelium daemon
```

## TUI (콕핏)

`mycelium`을 인자 없이 실행하면 k9s 스타일의 터미널 UI가 뜹니다. 폴더 트리(좌) · 세션 리스트(우상) · 상세(우하) 3-pane 구성이며, 여기서 라이프사이클 4단계를 전부 수행합니다:

- **Capture**: `n` — 폴더 컨텍스트를 주입한 채 Claude Code/Codex를 그 자리에서 띄우고(포그라운드), 종료하면 새 세션이 자동 캡처·정리됩니다. `h` — 현재 세션을 다른 에이전트로 이어받기.
- **Organize**: `m` 폴더 이동, `t` 태그 편집, `Space` 다중선택 후 일괄 적용.
- **Learn**: `A` 내용 기반 자동 태깅, `D` 다이제스트 생성, `K` 폴더 지식 추출, `d` 다이제스트 읽기.
- **Reuse**: `c` 조상 경로 컨텍스트 보기, `i` AGENTS.md 주입.
- **Find**: `/` 전문검색.

## 데이터 위치

모든 데이터는 `~/.mycelium/`에 로컬로 저장됩니다. **파일이 원본, sqlite는 파생 인덱스**(지워도 `mycelium reindex`로 재생성):

```
~/.mycelium/
  raw/<id>.json          중립 스키마로 정규화된 세션 (source of truth)
  tree/<폴더>/           사용자 폴더 구조 = 실제 디렉토리
    KNOWLEDGE.md         폴더별 프로젝트 지식 (상속 단위)
  digests/YYYY-MM-DD.md  서사형 다이제스트
  db/index.db            sqlite FTS5 검색 인덱스 (재생성 가능)
```

## 설계 원칙

- **로컬 전용**: 세션에는 민감한 업무(인사 등)가 포함되므로 외부 전송 없음. 인터페이스는 로컬 터미널 TUI. LLM 호출도 사용자 본인의 CLI 구독 경유.
- **모델 비종속**: 저장 포맷이 특정 벤더 세션 형식이 아닌 중립 스키마. 새 에이전트 추가 = 어댑터 한 파일.
- **사람 우선**: 자동 배치/태깅은 제안일 뿐, 사람이 정리한 세션(`organizedBy: human`)은 자동화가 절대 덮어쓰지 않음.
- **외부 의존성 0**: `node:sqlite`/`node:http`만 사용 → 감사 용이, 라이선스 충돌 없음(MIT).

## 상태

POC. 라이프사이클 4단계 전부 실제 로컬 세션(Claude Code + Codex)으로 동작 검증. TUI는 neo-blessed 기반, pty 스모크 테스트로 렌더/종료 확인(실제 상호작용은 사용자 터미널에서 검증).
