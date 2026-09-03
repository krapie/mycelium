# Mycelium

[![npm version](https://img.shields.io/npm/v/@kevinprk/mycelium)](https://www.npmjs.com/package/@kevinprk/mycelium)
[![npm downloads](https://img.shields.io/npm/dt/@kevinprk/mycelium)](https://www.npmjs.com/package/@kevinprk/mycelium)
[![CI](https://github.com/krapie/mycelium/actions/workflows/ci.yml/badge.svg)](https://github.com/krapie/mycelium/actions/workflows/ci.yml)
[![coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/krapie/511d91209145406ab7f7ed1e9fbcd49c/raw/mycelium-coverage.json)](https://github.com/krapie/mycelium/actions/workflows/coverage.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22.16-brightgreen)](https://nodejs.org)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/krapie/mycelium)

*[English guide](./README.md)*

**AI 세션을 정리하고, 그 세션들이 알게 된 것을 다음 세션으로 이어갑니다.**

작업하다 보면 AI 세션이 잔뜩 만들어지는데 대부분은 끝나는 순간 흩어져 버립니다. Mycelium은 그중 기억할 가치가 있는 것들을 정리하고, 그 세션들이 갖고 있던 지식·인사이트·맥락을 뽑아내서, 다음 세션이 시작될 때 이미 무엇이 중요했는지 알고 있게 만듭니다.

- **Capture** — Claude Code, Codex, Kiro, OpenCode 세션이 자동으로 한 곳에 모입니다.
- **Organize** — 프로젝트·케이스·서비스 단위로 묶입니다.
- **Learn** — 폴더 안 세션들에서 반복되는 것들이 지속적인 지식이 됩니다.
- **Reuse** — Mycelium에서 시작한 다음 세션은 그 지식·인사이트·맥락을 자동으로 물려받습니다.

Local-first, 모델 중립, 사람이 통제.

> 문서(`docs/`)와 코드 주석은 국제 협업을 위해 영어로 작성돼 있습니다. 이 파일은 한국어 이용 가이드입니다.

## 데모

![mycelium demo — Cloud Support Engineer의 케이스가 정리·학습되는 흐름](https://github.com/krapie/mycelium/releases/download/demo-assets/cse-highlight.gif)

`mycelium demo`가 같은 사이클을 인터랙티브하게 안내합니다. `npm install -g @kevinprk/mycelium && mycelium demo`로 실행해보세요. Cloud Support Engineer 대신 Software Engineer / Solutions Architect로 보고 싶으면, 시작할 때 페르소나를 다른 것으로 고르면 됩니다.

## 요구 사항

> **Mycelium은 사용자의 LLM 사용량을 소진합니다.** `organize`, `autotag`, `knowledge`, split 제안은 사용자의 `claude`/`codex` CLI를 호출합니다 — mycelium이 열려 있는 동안 백그라운드에서 자동으로도 호출됩니다. `MYCELIUM_NO_AUTOSTART=1`로 비활성화하거나, [`docs/cli.md`](./docs/cli.md)에서 조정하세요.

- Node.js ≥ 22.16, git
- AI 에이전트: `claude` / `codex` / `kiro-cli` / `opencode`

## 설치

```sh
npm install -g @kevinprk/mycelium   # npm
# 또는
brew install krapie/tap/mycelium    # Homebrew
```

직접 코드를 만지려면 clone:
```sh
git clone https://github.com/krapie/mycelium.git
cd mycelium && npm install && npm link
```

## 시작하기

```sh
mycelium        # TUI 실행 — 처음 실행 시 안내 투어 제공
mycelium demo   # 데모로 먼저 시도 — 별도 스토어, 실제 데이터 안 건드림
```

Claude Code, Codex, Kiro, OpenCode 세션은 백그라운드에서 자동으로 캡처됩니다 — 수동 스캔 필요 없음. 일상적으로는 단순한 반복입니다, 바로 **Context Flywheel**: `s` 캡처 → `o` 정리 → `w` 학습 → `n` 필요한 모든 게 준비된 채로 다음 세션 시작. 대부분은 이미 백그라운드에서 저절로 돌아갑니다. 이 키들을 누르는 건 대부분 처음부터 뭔가 시작시키는 게 아니라 이미 준비된 걸 검토·확인하는 것에 가깝습니다.

`mycelium demo`는 mock 세션 위에서 같은 사이클을 안내합니다. 언어와 페르소나를 고르고, 튜토리얼을 끝까지 마치면 실제 세션으로 바로 넘어갑니다 — 중간에 `Esc`로 나가면 그냥 종료되고, 실제 `~/.mycelium` 스토어는 어느 쪽이든 건드리지 않습니다.

기본 언어는 영어입니다 — 언제든 `mycelium lang <en|ko>`, TUI 안에서 `l` 키, 또는 첫 실행 시 뜨는 언어 선택으로 전환할 수 있습니다.

> `npm link`를 건너뛰었다면 `node src/cli.js <command>`로 대체하세요.

Mycelium은 모든 데이터를 사용자 머신(`~/.mycelium/`)에만 저장하며 서버·텔레메트리가 없습니다 — 이미 `claude`/`codex` 사용이 허용된 제한적인 조직에서도 안전하게 사용할 수 있습니다. 단, LLM 호출(organize/autotag/knowledge)은 세션 내용을 provider로 전송한다는 점은 CLI 직접 사용과 동일하게 적용됩니다.

## 더 알아보기

전체 가이드는 [`docs/`](./docs)에 있습니다:

- [**How It Works**](./docs/how-it-works.md) — 다이어그램 두 장으로 보는 루프와 그 원리
- [**TUI**](./docs/tui.md) — 3컬럼 인터페이스 + 전체 키보드 단축키
- [**Learn/Reuse 루프**](./docs/learn-reuse.md) — 세션들이 지식을 다음으로 어떻게 전달하는지
- [**Handoff**](./docs/handoff.md) — 에이전트 CLI 간에 작업을 이어가는 법
- [**CLI 레퍼런스**](./docs/cli.md) — 스크립팅용 서브커맨드 전체
- [**Architecture**](./docs/architecture.md) — 데이터 위치, 설계 원칙, 상태
- [**Feature catalog**](./docs/features.md) — 모든 기능, 테스트 커버리지 상태 포함
- [**Roadmap**](./ROADMAP.md) — 프로젝트의 방향과 명시적 비목표(non-goals)

## 정리 (실험 단계)

```sh
mycelium cleanup            # 안전: Mycelium 자체 LLM-call 세션 + 빈 폴더 제거, 인덱스 재구성
mycelium cleanup reset --yes # 되돌릴 수 없음: ~/.mycelium 전체 삭제
```

`tidy`/`folders`/`archive`/`index`/`reset`은 원본 에이전트 로그를 절대 건드리지 않으므로, `mycelium scan`으로 언제든 다시 만들 수 있습니다 — 전체 설명은 [`docs/cli.md`](./docs/cli.md) 참고.

## 기여

개발 환경 세팅, lint/test, 새 AI 에이전트 CLI 추가 방법은 [`CONTRIBUTING.md`](./CONTRIBUTING.md)에.

## AI 에이전트로 이 저장소 작업하기

Mycelium 자체 위에서 Claude Code, Codex, Cursor 같은 도구를 쓰고 있다면, 먼저 [`AGENTS.md`](./AGENTS.md)를 열게 하세요 — 컨벤션·키 바인딩·기여 워크플로우를 담은 밀도 높은 레퍼런스입니다. (Claude Code는 AGENTS.md를 자동으로 안 읽으므로, 이 저장소 루트의 `CLAUDE.md`가 그걸 대신 import합니다.)
