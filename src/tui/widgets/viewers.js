import pkg from 'neo-blessed';
const blessed = pkg.default || pkg;
import { C } from '../theme.js';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DIGEST_DIR } from '../../paths.js';
import { copyToClipboard } from '../clipboard.js';
import { generateDigest } from '../../insight.js';
import { t } from '../i18n.js';

/** Scrollable read-only overlay for markdown/text (context, knowledge, digest). */
export function textView(app, title, content) {
  const box = blessed.box({
    parent: app.screen,
    top: 'center',
    left: 'center',
    width: '80%',
    height: '80%',
    label: t('viewer.textViewLabel', title),
    content: content || t('common.noContent'),
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
    box.setLabel(ok ? t('viewer.copiedLabel', title) : t('viewer.copyFailedLabel', title));
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
    label: t('viewer.confirmLabel', title),
    content: content || t('common.noContent'),
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
    label: t('digest.label'),
    items: files.length ? files : [t('digest.empty')],
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
    box.setItems(files.length ? files : [t('digest.empty')]);
    app.render();
  };
  const generate = async (period) => {
    // Small local spinner on the box's own label — this widget has no
    // shared toast to drive (unlike app.js's startSpinner(), which animates
    // the notify() toast other LLM-bound actions use), so just tick the
    // label directly. Same braille frame set as startSpinner(), not worth
    // sharing for this one differently-shaped call site.
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let i = 0;
    const tick = () => {
      box.setLabel(`${frames[(i = (i + 1) % frames.length)]} ${t('digest.generating')}`);
      app.render();
    };
    tick();
    const timer = setInterval(tick, 120);
    const res = await generateDigest({ period });
    clearInterval(timer);
    box.setLabel(res.ok ? t('digest.generated', res.keyed) : t('digest.failed', res.error));
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
    const md = existsSync(path) ? readFileSync(path, 'utf8') : t('digest.readFailed');
    textView(app, files[idx], md);
  });
}

/**
 * One-time first-run overlay — same shape as helpModal() below but shorter
 * and specifically oriented at "what do I do right now", not a full
 * reference. index.js shows this once (gated on config.json's `onboarded`
 * flag) right after the sessions view mounts; `onDismiss` is where the
 * caller persists that flag so it never shows again.
 */
export function welcomeModal(app, onDismiss) {
  const box = blessed.box({
    parent: app.screen,
    top: 'center',
    left: 'center',
    width: '70%',
    height: 'shrink',
    label: t('welcome.modalLabel'),
    content: t('welcome.body', C.fox, C.spore),
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
  const close = () => {
    box.destroy();
    app.render();
    if (onDismiss) onDismiss();
  };
  box.key(['escape', 'enter', 'q'], close);
  return box;
}

/** Full keymap reference — bound to `?` from anywhere. */
export function helpModal(app) {
  const box = blessed.box({
    parent: app.screen,
    top: 'center',
    left: 'center',
    width: '70%',
    height: '80%',
    label: t('help.modalLabel'),
    content: t('help.text', C.fox, C.spore),
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
