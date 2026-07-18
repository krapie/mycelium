import pkg from 'neo-blessed';
const blessed = pkg.default || pkg;
import { C } from '../theme.js';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DIGEST_DIR } from '../../paths.js';
import { copyToClipboard } from '../clipboard.js';

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

/** Digest picker → reader. Lists digests/*.md, opens the chosen one in a textView. */
export function digestReader(app) {
  let files = [];
  try {
    files = readdirSync(DIGEST_DIR).filter((f) => f.endsWith('.md')).sort().reverse();
  } catch {
    /* none */
  }
  if (!files.length) {
    app.notify('아직 다이제스트가 없습니다 (D로 생성)', 3);
    return;
  }
  const box = blessed.list({
    parent: app.screen,
    top: 'center',
    left: 'center',
    width: '50%',
    height: '60%',
    label: ' 다이제스트 (Enter 열기, Esc 닫기) ',
    items: files,
    keys: true,
    mouse: true,
    border: { type: 'line' },
    style: { border: { fg: C.fox }, selected: { bg: C.surface, fg: C.text }, fg: C.dim },
  });
  box.focus();
  app.render();
  box.key(['escape'], () => {
    box.destroy();
    app.render();
  });
  box.on('select', (_, idx) => {
    const path = join(DIGEST_DIR, files[idx]);
    box.destroy();
    const md = existsSync(path) ? readFileSync(path, 'utf8') : '(읽기 실패)';
    textView(app, files[idx], md);
  });
}
