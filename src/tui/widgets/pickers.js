import pkg from 'neo-blessed';
const blessed = pkg.default || pkg;
import { C } from '../theme.js';
import * as data from '../data.js';

/**
 * Folder picker: choose an existing folder or create a new path. Returns the
 * chosen folder path (or null for unfiled/New) via cb. _archive is hidden
 * from the main folder panel (see tui/data.js) but still a valid, common move
 * *target* — listed explicitly here rather than making you type it by hand.
 */
export function pickFolder(app, cb) {
  const { list } = data.folders();
  const entries = [
    { label: '{gray-fg}New (미분류){/}', value: null },
    ...list.map((f) => ({ label: f, value: f })),
    { label: `{${C.faint}-fg}_archive{/}`, value: '_archive' },
    { label: `{${C.spore}-fg}+ 새 폴더 입력…{/}`, value: '__create__' },
  ];
  const box = blessed.list({
    parent: app.screen,
    top: 'center',
    left: 'center',
    width: '60%',
    height: '60%',
    label: ' 폴더 선택 (Enter, Esc 취소) ',
    items: entries.map((e) => e.label),
    tags: true,
    keys: true,
    mouse: true,
    scrollbar: { ch: ' ', style: { bg: C.border } },
    border: { type: 'line' },
    style: { border: { fg: C.fox }, selected: { bg: C.surface, fg: C.text }, fg: C.dim },
  });
  box.focus();
  app.render();
  const close = () => {
    box.destroy();
    app.render();
  };
  box.key(['escape'], () => {
    close();
    cb(undefined);
  });
  box.on('select', (_, idx) => {
    const val = entries[idx].value;
    close();
    if (val === '__create__') {
      textPrompt(app, '새 폴더 경로 (예: 회사/플랫폼/인증)', '', (v) => cb(v ? v.trim() : undefined));
    } else {
      cb(val);
    }
  });
}

/** Tag editor: shows current tags, accepts `+tag -tag` syntax like the CLI. */
export function editTags(app, current, cb) {
  const shown = current.length ? current.map((t) => '#' + t).join(' ') : '(없음)';
  textPrompt(app, `태그 편집 — 현재: ${shown}\n+추가 -삭제 (예: +긴급 -오분류)`, '', (v) => {
    if (v == null) return cb(null);
    const add = [];
    const remove = [];
    for (const tok of v.split(/\s+/).filter(Boolean)) {
      if (tok.startsWith('-')) remove.push(tok.slice(1));
      else add.push(tok.replace(/^\+/, ''));
    }
    cb({ add, remove });
  });
}

export function textPrompt(app, label, initial, cb) {
  // No border label — the question is shown inside via .input() (setting both
  // makes the title appear twice).
  const p = blessed.prompt({
    parent: app.screen,
    top: 'center',
    left: 'center',
    width: '60%',
    height: 'shrink',
    border: { type: 'line' },
    tags: true,
    style: { border: { fg: C.fox }, fg: C.text },
  });
  p.input(label, initial || '', (err, val) => {
    p.destroy();
    app.render();
    cb(err ? null : val);
  });
}

/** A small menu picker returning the chosen value. */
export function menu(app, label, choices, cb) {
  const box = blessed.list({
    parent: app.screen,
    top: 'center',
    left: 'center',
    width: '40%',
    // Explicit height — blessed 'shrink' on a list can render only the first
    // item, which was hiding the second agent (e.g. Codex) in the handoff menu.
    height: Math.min(choices.length + 2, 14),
    label: ` ${label} `,
    tags: true,
    keys: true,
    mouse: true,
    items: choices.map((c) => c.label),
    border: { type: 'line' },
    style: { border: { fg: C.fox }, selected: { bg: C.surface, fg: C.text }, fg: C.dim },
  });
  box.focus();
  app.render();
  box.key(['escape'], () => {
    box.destroy();
    app.render();
    cb(undefined);
  });
  box.on('select', (_, idx) => {
    box.destroy();
    app.render();
    cb(choices[idx].value);
  });
}
