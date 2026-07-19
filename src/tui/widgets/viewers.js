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
