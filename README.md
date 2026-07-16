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

# 상시 실행 (스캔 폴링 + 다이제스트 스케줄 + 웹 UI)
mycelium daemon                 # http://127.0.0.1:7420
```

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

- **로컬 전용**: 세션에는 민감한 업무(인사 등)가 포함되므로 외부 전송 없음. 웹 UI도 기본 `127.0.0.1` 바인딩. LLM 호출도 사용자 본인의 CLI 구독 경유.
- **모델 비종속**: 저장 포맷이 특정 벤더 세션 형식이 아닌 중립 스키마. 새 에이전트 추가 = 어댑터 한 파일.
- **사람 우선**: 자동 배치/태깅은 제안일 뿐, 사람이 정리한 세션(`organizedBy: human`)은 자동화가 절대 덮어쓰지 않음.
- **외부 의존성 0**: `node:sqlite`/`node:http`만 사용 → 감사 용이, 라이선스 충돌 없음(MIT).

## 상태

POC. 라이프사이클 4단계 전부 실제 로컬 세션(Claude Code + Codex)으로 동작 검증. 웹 UI는 API 레벨까지 검증(브라우저 시각 확인은 미완).
