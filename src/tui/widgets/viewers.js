import pkg from 'neo-blessed';
const blessed = pkg.default || pkg;
import { C } from '../theme.js';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DIGEST_DIR } from '../../paths.js';
import { copyToClipboard } from '../clipboard.js';
import { generateDigest } from '../../insight.js';

/** Scrollable read-only overlay for markdown/text (context, knowledge, digest). */
export function textView(app, title, content) {
  const box = blessed.box({
    parent: app.screen,
    top: 'center',
    left: 'center',
    width: '80%',
    height: '80%',
    label: ` ${title} (↑↓ 스크롤, y 복사, Esc 닫기) `,
    content: content || '(내용 없음)',
    tags: false,
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    mouse: true,
    padding: { left: 1, right: 1 },
    scrollbar: { ch: ' ', style: { bg: C.border } },
    border: { type: 'line' },
    style: { border: { fg: C.fox }, fg: C.text },
  });
  box.focus();
  app.render();
  box.key(['escape', 'q'], () => {
    box.destroy();
    app.render();
  });
  box.key('y', () => {
    const ok = copyToClipboard(content || '');
    box.setLabel(ok ? ` ${title} (복사됨) ` : ` ${title} (복사 실패) `);
    app.render();
  });
  return box;
}

/**
 * Scrollable preview that requires an explicit yes/no before cb fires — for
 * content the human should review before it's written (KNOWLEDGE.md,
 * AGENTS.md injection). LLM output shouldn't land on disk unreviewed, and
 * once it's in KNOWLEDGE.md it gets auto-injected into every future session
 * in that folder, so this is the one checkpoint a person actually sees it.
 */
export function confirmText(app, title, content, cb) {
  const box = blessed.box({
    parent: app.screen,
    top: 'center',
    left: 'center',
    width: '80%',
    height: '80%',
    label: ` ${title} (↑↓ 스크롤, y/Enter 저장, n/Esc 취소) `,
    content: content || '(내용 없음)',
    tags: false,
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    mouse: true,
    padding: { left: 1, right: 1 },
    scrollbar: { ch: ' ', style: { bg: C.border } },
    border: { type: 'line' },
    style: { border: { fg: C.fox }, fg: C.text },
  });
  box.focus();
  app.render();
  let settled = false;
  const finish = (ok) => {
    if (settled) return;
    settled = true;
    box.destroy();
    app.render();
    cb(ok);
  };
  box.key(['y', 'enter'], () => finish(true));
  box.key(['n', 'escape', 'q'], () => finish(false));
}

/** Digest picker → reader. Lists digests/*.md, opens the chosen one in a textView. */
export function digestReader(app) {
  const listFiles = () => {
    try {
      return readdirSync(DIGEST_DIR).filter((f) => f.endsWith('.md')).sort().reverse();
    } catch {
      return [];
    }
  };
  let files = listFiles();

  const box = blessed.list({
    parent: app.screen,
    top: 'center',
    left: 'center',
    width: '50%',
    height: '60%',
    label: ' 다이제스트 (Enter 열기, n 오늘 생성, w 이번주 생성, Esc 닫기) ',
    items: files.length ? files : ['{gray-fg}(없음 — n/w로 생성){/}'],
    tags: true,
    keys: true,
    mouse: true,
    border: { type: 'line' },
    style: { border: { fg: C.fox }, selected: { bg: C.surface, fg: C.text }, fg: C.dim },
  });
  box.focus();
  app.render();

  const refresh = () => {
    files = listFiles();
    box.setItems(files.length ? files : ['{gray-fg}(없음 — n/w로 생성){/}']);
    app.render();
  };
  const generate = async (period) => {
    box.setLabel(' 다이제스트 생성 중… ');
    app.render();
    const res = await generateDigest({ period });
    box.setLabel(res.ok ? ` 생성: ${res.keyed} ` : ` 실패: ${res.error} `);
    refresh();
  };

  box.key(['escape'], () => {
    box.destroy();
    app.render();
  });
  box.key('n', () => generate('day'));
  box.key('w', () => generate('week'));
  box.on('select', (_, idx) => {
    if (!files.length) return;
    const path = join(DIGEST_DIR, files[idx]);
    box.destroy();
    const md = existsSync(path) ? readFileSync(path, 'utf8') : '(읽기 실패)';
    textView(app, files[idx], md);
  });
}

const HELP_TEXT = `{bold}전역{/}
  {${C.fox}-fg}s{/}       스캔 (mycelium scan, CLI 없이 — 자동배치는 아직 CLI \`mycelium organize\`로)
  {${C.fox}-fg}/{/}       전문 검색
  {${C.fox}-fg}d{/}       다이제스트 보기 (열어서 n/w로 오늘/이번주 생성)
  {${C.fox}-fg}?{/}       이 도움말
  {${C.fox}-fg}q{/}       종료

{bold}폴더 패널{/}
  {${C.fox}-fg}Enter{/}   이 폴더의 세션 보기
  {${C.fox}-fg}a{/}       새 (하위)폴더
  {${C.fox}-fg}e{/}       이름 변경
  {${C.fox}-fg}m{/}       이동 / 중첩
  {${C.fox}-fg}x{/}       삭제 (세션은 미분류로, All에서 New로 표시)
  {${C.fox}-fg}w{/}       폴더 지식(KNOWLEDGE.md) 추출 — 미리보기 후 확인

{bold}세션 패널{/}
  {${C.fox}-fg}Enter{/}   상세 보기
  {${C.fox}-fg}Esc{/}     폴더 패널로
  {${C.fox}-fg}a{/}       요약·태그 생성 (LLM, 다중 선택 시 일괄)
  {${C.fox}-fg}e{/}       제목·요약 직접 편집 ($EDITOR, Mycelium 저장소만)
  {${C.fox}-fg}y{/}       클립보드로 복사
  {${C.fox}-fg}r{/}       이어열기 (원래 에이전트로 resume)
  {${C.fox}-fg}h{/}       핸드오프 (다른 에이전트로 새 세션 시작)
  {${C.fox}-fg}n{/}       이 폴더 컨텍스트로 새 에이전트 세션
  {${C.fox}-fg}m{/} / {${C.fox}-fg}t{/}   폴더 이동 / 태그 편집
  {${C.fox}-fg}x{/}       세션 삭제 (Mycelium 저장소에서만, 원본 로그 유지)
  {${C.fox}-fg}w{/}       폴더 지식 추출 — 미리보기 후 확인
  {${C.fox}-fg}c{/}       상속 컨텍스트 보기
  {${C.fox}-fg}i{/}       AGENTS.md에 주입 — 미리보기 후 확인
  {${C.fox}-fg}Space{/}   다중 선택

{bold}상세 패널{/}
  {${C.fox}-fg}↑↓{/}      스크롤
  {${C.fox}-fg}Esc{/}     세션 패널로
  {${C.fox}-fg}a / e / y / r / x{/}  세션 패널과 동일

핸드오프로 이어진 세션은 목록에 {${C.spore}-fg}↩{/}/{${C.spore}-fg}→{/} 마커, 상세에 이어받음/이어감 링크로 표시됩니다.`;

/** Full keymap reference — bound to `?` from anywhere. */
export function helpModal(app) {
  const box = blessed.box({
    parent: app.screen,
    top: 'center',
    left: 'center',
    width: '70%',
    height: '80%',
    label: ' 단축키 도움말 (↑↓ 스크롤, Esc/? 닫기) ',
    content: HELP_TEXT,
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    mouse: true,
    padding: { left: 1, right: 1 },
    scrollbar: { ch: ' ', style: { bg: C.border } },
    border: { type: 'line' },
    style: { border: { fg: C.fox }, fg: C.text },
  });
  box.focus();
  app.render();
  box.key(['escape', 'q', '?'], () => {
    box.destroy();
    app.render();
  });
  return box;
}
