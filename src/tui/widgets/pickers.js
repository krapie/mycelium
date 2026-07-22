import pkg from 'neo-blessed';
const blessed = pkg.default || pkg;
import { C } from '../theme.js';
import * as data from '../data.js';
import { t } from '../i18n.js';

/**
 * Folder picker: choose an existing folder or create a new path. Returns the
 * chosen folder path (or null for unfiled/New) via cb. _archive is hidden
 * from the main folder panel (see tui/data.js) but still a valid, common move
 * *target* — listed explicitly here rather than making you type it by hand.
 */
export function pickFolder(app, cb) {
  const { list } = data.folders();
  const entries = [
    { label: t('picker.newLabel'), value: null },
    ...list.map((f) => ({ label: f, value: f })),
    { label: `{${C.faint}-fg}_archive{/}`, value: '_archive' },
    { label: `{${C.spore}-fg}${t('picker.createNew')}{/}`, value: '__create__' },
  ];
  const box = blessed.list({
    parent: app.screen,
    top: 'center',
    left: 'center',
    width: '60%',
    height: '60%',
    label: t('picker.folderLabel'),
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
      textPrompt(app, t('picker.newPathPrompt'), '', (v) => cb(v ? v.trim() : undefined));
    } else {
      cb(val);
    }
  });
}

/** Tag editor: shows current tags, accepts `+tag -tag` syntax like the CLI. */
export function editTags(app, current, cb) {
  const shown = current.length ? current.map((tag) => '#' + tag).join(' ') : t('common.none');
  textPrompt(app, t('picker.tagEditPrompt', shown), '', (v) => {
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

/**
 * Multi-select review list — for suggestions the human should cherry-pick
 * from rather than accept-or-reject as a whole (e.g. smart-organize
 * placements). Nothing starts selected: like the sessions list's own
 * Space/* multi-select, you opt sessions IN rather than opt bad ones out.
 * Enter applies only the checked items; Esc applies nothing.
 */
export function multiSelectList(app, label, items, cb) {
  const selected = new Set();
  const render = (it, i) => `${selected.has(i) ? `{${C.fox}-fg}✓{/} ` : '  '}${it.label}`;
  const box = blessed.list({
    parent: app.screen,
    top: 'center',
    left: 'center',
    width: '70%',
    height: Math.min(items.length + 4, 20),
    label: ` ${label} — space select, * all, enter apply, esc cancel `,
    tags: true,
    keys: true,
    mouse: true,
    items: items.map(render),
    border: { type: 'line' },
    style: { border: { fg: C.fox }, selected: { bg: C.surface, fg: C.text }, fg: C.dim },
  });
  const refresh = () => {
    items.forEach((it, i) => box.setItem(i, render(it, i)));
    app.render();
  };
  box.focus();
  app.render();
  box.key(['space'], () => {
    const i = box.selected;
    if (selected.has(i)) selected.delete(i);
    else selected.add(i);
    refresh();
  });
  box.key(['*'], () => {
    if (selected.size === items.length) selected.clear();
    else items.forEach((_, i) => selected.add(i));
    refresh();
  });
  box.key(['escape'], () => {
    box.destroy();
    app.render();
    cb(null);
  });
  box.key(['enter'], () => {
    box.destroy();
    app.render();
    cb(items.filter((_, i) => selected.has(i)).map((it) => it.value));
  });
}
