import pkg from 'neo-blessed';
const blessed = pkg.default || pkg;
import { C } from '../theme.js';
import * as data from '../data.js';
import { t } from '../i18n.js';
import { textView } from './viewers.js';

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

/**
 * A small menu picker returning the chosen value.
 *
 * `dismissOnBlur` (default `false`) auto-destroys the menu if focus moves
 * elsewhere, firing `cb(undefined)` rather than a chosen value — used by
 * the action palette (`.`), whose screen-key shortcuts (e.g. `o` while the
 * palette is open) don't consume the keypress: sessions.js's own `o`
 * handler fires and opens its own modal on top, leaving the palette
 * stranded underneath. isModalOpen() (tutorial.js) then never sees
 * children drop back to baseline and the narrator's close-poll hangs
 * forever. `cb(undefined)` is indistinguishable from a plain Escape
 * dismissal — callers already treat "no value" as a no-op either way (see
 * sessions.js's own `cb`), so this never needs a separate signal. Normal
 * menus (folder picker, resume choices, etc.) legitimately open sub-modals
 * in their own `cb` and must NOT auto-dismiss — hence opt-in.
 */
export function menu(app, label, choices, cb, { width = '40%', dismissOnBlur = false } = {}) {
  // A choice with `header: true` is a non-selectable section label (e.g. the
  // action palette's SESSION/FOLDER groups) — shown dimmed, indented siblings,
  // and skipped on select so Enter/click on it does nothing. Only affects
  // menus that actually pass headers; a plain choice list renders unchanged.
  const hasHeaders = choices.some((c) => c.header);
  const box = blessed.list({
    parent: app.screen,
    top: 'center',
    left: 'center',
    width,
    // Explicit height — blessed 'shrink' on a list can render only the first
    // item, which was hiding the second agent (e.g. Codex) in the handoff menu.
    height: Math.min(choices.length + 2, 14),
    label: ` ${label} `,
    tags: true,
    keys: true,
    mouse: true,
    items: choices.map((c) =>
      c.header ? `{${C.text}-fg}{bold}${c.label}{/bold}{/}` : hasHeaders ? `  {${C.claude}-fg}${c.label}{/}` : c.label,
    ),
    border: { type: 'line' },
    style: { border: { fg: C.fox }, selected: { bg: C.surface, fg: C.text }, fg: C.dim },
  });
  // Don't land the initial highlight on a leading header row.
  const firstSelectable = choices.findIndex((c) => !c.header);
  if (firstSelectable > 0) box.select(firstSelectable);
  box.focus();
  app.render();
  let closed = false;
  const close = (value) => {
    if (closed) return;
    closed = true;
    box.destroy();
    app.render();
    cb(value);
  };
  if (dismissOnBlur) {
    // Fires when another widget calls .focus() — a real user picking a menu
    // item routes through `select` first (which sets `closed`), so this
    // path only trips when something ELSE stole focus (a screen-key like
    // `o` opening its own modal on top of the palette).
    box.on('blur', () => close(undefined));
  }
  box.key(['escape'], () => close(undefined));
  box.on('select', (_, idx) => {
    if (choices[idx]?.header) return; // header row — not a choice
    close(choices[idx].value);
  });
}

/**
 * Multi-select review list — for suggestions the human should cherry-pick
 * from rather than accept-or-reject as a whole (e.g. smart-organize
 * placements, split review). By default nothing starts selected: like the
 * sessions list's own Space/* multi-select, you opt items IN rather than
 * opt bad ones out. Pass `defaultAll: true` for the opposite shape — every
 * item pre-checked, so Enter alone accepts everything and Space is only
 * needed to opt individual bad ones OUT (smart-organize's placements: the
 * LLM already did the picking, this is a chance to catch a wrong one, not
 * to select good ones one at a time). Enter applies the checked items;
 * Esc applies nothing.
 */
// `previewText(value)` (optional): when given, `p` opens a full scrollable
// textView of that content for whichever row is currently highlighted —
// for content bound for somewhere as consequential as an external
// project's AGENTS.md (the knowledge review, `k`), the one-line label
// truncation isn't enough to actually review before approving; this is
// the confirmText()-style "see it before it lands on disk" checkpoint
// applied to a per-item preview instead of a single whole-batch one.
// Optional (not every multiSelectList caller has long-form content per
// item worth a dedicated preview — o's placement suggestions don't).
export function multiSelectList(app, label, items, cb, { defaultAll = false, previewText } = {}) {
  const selected = new Set(defaultAll ? items.map((_, i) => i) : []);
  const render = (it, i) => `${selected.has(i) ? `{${C.fox}-fg}✓{/} ` : '  '}${it.label}`;
  const hintTail = previewText ? 'p preview, enter apply, esc cancel' : 'enter apply, esc cancel';
  const box = blessed.list({
    parent: app.screen,
    top: 'center',
    left: 'center',
    width: '70%',
    height: Math.min(items.length + 4, 20),
    label: defaultAll
      ? ` ${label} — all checked, space to uncheck, ${hintTail} `
      : ` ${label} — space select, * all, ${hintTail} `,
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
  if (previewText) {
    box.key(['p'], () => {
      const it = items[box.selected];
      if (it) textView(app, it.label.replace(/\{[^}]*\}/g, ''), previewText(it.value), ['p']);
    });
  }
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
