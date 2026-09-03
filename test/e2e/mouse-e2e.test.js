import test from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from '../helpers.js';
import { createTestApp, sendClick, sendWheel, sendKey } from '../tui-helpers.js';

// Mouse coverage for issue #68. Mouse events turned out to be drivable
// through the exact same fake-stream seam the key tests use — see
// tui-helpers.js's sgrMouse()/sendClick() comment for why (blessed parses
// mouse escape sequences off the input stream itself; no TTY, no pty, no
// real pointer). So this asserts the real rule the TUI now follows
// everywhere, against real resulting state, not rendered output:
//
//   click            → cursor moves to the clicked row, panel takes focus
//   click again      → activates that row (exactly what Enter does there)
//   wheel            → cursor moves, same live preview the arrows give
//
// The parts that were broken before: the Folders and Sessions lists had no
// `mouse: true` at all (so a click did nothing, even though mouse tracking
// was globally ON because the Detail panel opts in), and `state.level` only
// ever followed the keyboard drill helpers, so anything blessed focused on
// its own left the layout and the `.` action palette describing the wrong
// panel.

useTempHome();

const { createApp } = await import('../../src/tui/app.js');
const { sessionsView } = await import('../../src/tui/views/sessions.js');
const { saveRaw } = await import('../../src/scanner.js');
const { emptyNeutral } = await import('../../src/schema.js');
const { reindex } = await import('../../src/index-db.js');
const { mkdir } = await import('../../src/organize/folders.js');
const { menu, multiSelectList } = await import('../../src/tui/widgets/pickers.js');

function cleanup(app) {
  app.screen.destroy();
}

function panel(app, re) {
  return app.body.children.find((c) => c._label && re.test(c._label.content));
}

// lpos is only populated by a render, and the item boxes only exist once
// their list has items — so every caller renders first, then measures.
function clickRow(app, input, list, i) {
  app.render();
  const item = list.items[i];
  assert.ok(item && item.lpos, `list row ${i} is rendered and measurable`);
  sendClick(input, item.lpos.xi + 1, item.lpos.yi);
}

const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));

async function mount() {
  mkdir('alpha');
  mkdir('beta');
  for (const [id, folder, text] of [
    ['alpha-1', 'alpha', 'alpha first session'],
    ['alpha-2', 'alpha', 'alpha second session'],
    ['beta-1', 'beta', 'beta only session'],
  ]) {
    const n = emptyNeutral(id, 'claude');
    n.folder = folder;
    n.turns = [{ role: 'user', text }];
    n.extracted.title = text;
    saveRaw(n);
  }
  reindex();

  const { input, output } = createTestApp();
  const app = createApp({ input, output });
  let api;
  await app.show(sessionsView({ onReady: (a) => (api = a) }));
  await settle(50);
  return {
    app,
    input,
    api,
    foldersBox: panel(app, /Folders/),
    listBox: api.listBox,
    detailBox: panel(app, /Detail/),
  };
}

test('clicking a folder row moves the cursor AND live-previews it, same as an arrow key', async () => {
  const { app, input, api, foldersBox, listBox } = await mount();
  try {
    // Rows: 0 Root, 1 New, 2 alpha, 3 beta.
    assert.equal(api.state.folder, undefined, 'starts on Root');

    clickRow(app, input, foldersBox, 3);
    await settle();
    assert.equal(foldersBox._keys[foldersBox.selected], 'beta', 'cursor moved to the clicked row');
    assert.equal(api.state.folder, 'beta', 'and the click previewed it — not just a highlight move');
    assert.equal(listBox.items.length, 1, 'the Sessions panel reloaded to that folder');
  } finally {
    cleanup(app);
  }
});

test('clicking the folder row already under the cursor drills in, exactly like Enter', async () => {
  const { app, input, api, foldersBox, listBox } = await mount();
  try {
    clickRow(app, input, foldersBox, 2);
    await settle();
    assert.equal(api.state.level, 'folders', 'first click only selects');

    clickRow(app, input, foldersBox, 2);
    await settle();
    assert.equal(api.state.level, 'sessions', 'second click on the same row drills into Sessions');
    assert.equal(app.screen.focused, listBox, 'and moves focus there');
    assert.equal(api.state.folder, 'alpha', 'still on the folder that was clicked');
  } finally {
    cleanup(app);
  }
});

test('Enter still drills exactly once after the key(enter) → on(select) swap', async () => {
  const { app, input, api, listBox } = await mount();
  try {
    // Regression guard for the change that made click-to-activate possible:
    // blessed's list already emits `select` for Enter, so keeping the old
    // key('enter') binding alongside it would run the drill twice per press.
    sendKey(input, 'down'); // Root -> New
    await settle(40);
    sendKey(input, 'enter');
    await settle();
    assert.equal(api.state.level, 'sessions');
    assert.equal(app.screen.focused, listBox);

    sendKey(input, 'enter'); // and on into Detail
    await settle();
    assert.equal(api.state.level, 'detail');
  } finally {
    cleanup(app);
  }
});

test('clicking a session row previews it; clicking it again opens the Detail panel', async () => {
  const { app, input, api, foldersBox, listBox, detailBox } = await mount();
  try {
    clickRow(app, input, foldersBox, 2); // alpha (2 sessions)
    await settle();

    clickRow(app, input, listBox, 1);
    await settle();
    assert.equal(listBox.selected, 1, 'cursor moved to the clicked session');
    assert.equal(api.state.level, 'sessions', 'and the panel took focus');
    const shown = detailBox.getContent();
    assert.ok(/alpha (first|second) session/.test(shown), 'Detail panel followed the click');

    clickRow(app, input, listBox, 1);
    await settle();
    assert.equal(api.state.level, 'detail', 'second click drills into Detail');
    assert.equal(app.screen.focused, detailBox);
  } finally {
    cleanup(app);
  }
});

test('the wheel moves a list cursor and previews with it, not just the highlight', async () => {
  const { app, input, api, foldersBox } = await mount();
  try {
    app.render();
    // blessed's list wheel handler moves the cursor by 2 — from Root that
    // lands on "alpha" (0 Root, 1 New, 2 alpha).
    sendWheel(input, 'down', foldersBox.lpos.xi + 2, foldersBox.lpos.yi + 2);
    await settle();
    assert.equal(foldersBox._keys[foldersBox.selected], 'alpha', 'wheel moved the cursor');
    assert.equal(api.state.folder, 'alpha', 'and previewed the folder it landed on');
  } finally {
    cleanup(app);
  }
});

test('clicking a panel keeps state.level in sync with focus, so the layout and `.` palette follow', async () => {
  const { app, input, api, foldersBox, detailBox } = await mount();
  try {
    clickRow(app, input, foldersBox, 2);
    await settle();
    assert.equal(api.state.level, 'folders');

    app.render();
    sendClick(input, detailBox.lpos.xi + 3, detailBox.lpos.yi + 2);
    await settle();
    assert.equal(app.screen.focused, detailBox, 'blessed focused the clicked panel');
    assert.equal(api.state.level, 'detail', 'and state.level followed it');

    app.render();
    sendClick(input, foldersBox.lpos.xi + 3, foldersBox.lpos.yi + 1);
    await settle();
    assert.equal(api.state.level, 'folders', 'clicking back reverts it');
  } finally {
    cleanup(app);
  }
});

// A click lands on a list's item Box, not on the list itself, and blessed
// focuses whatever it landed on. If focus stuck there, every key binding on
// the list (including the arrows `keys: true` handles internally) would go
// dead the moment a user touched the mouse — the one regression that would
// make the mouse work here a net loss.
test('keys still reach the list after a click, not only before one', async () => {
  const { app, input, api, foldersBox } = await mount();
  try {
    clickRow(app, input, foldersBox, 2);
    await settle();
    const landed = foldersBox.selected;
    assert.equal(foldersBox._keys[landed], 'alpha', 'click put the cursor on alpha');

    sendKey(input, 'down');
    await settle();
    assert.equal(foldersBox.selected, landed + 1, 'the arrow key still moved the cursor');
    assert.equal(api.state.folder, foldersBox._keys[landed + 1], 'and still previewed what it landed on');
  } finally {
    cleanup(app);
  }
});

// The modal lists are the other half of the surface a click can land on.
// menu()/pickFolder() already routed Enter through `select` and so already
// answered a second click; multiSelectList() didn't, and is the one that
// changed here.

function openModalOn(app) {
  return app.screen.children[app.screen.children.length - 1];
}

test('menu(): a second click on the highlighted entry picks it, same as Enter', async () => {
  const { app, input } = await mount();
  try {
    let picked;
    menu(app, 'pick one', [
      { label: 'first', value: 'a' },
      { label: 'second', value: 'b' },
    ], (v) => (picked = v));
    const box = openModalOn(app);

    clickRow(app, input, box, 1);
    await settle();
    assert.equal(picked, undefined, 'one click only moves the cursor');
    assert.equal(box.selected, 1);

    clickRow(app, input, box, 1);
    await settle();
    assert.equal(picked, 'b', 'the second click picks the row it is on');
  } finally {
    cleanup(app);
  }
});

test('multiSelectList(): a second click applies the checked set, and Enter still applies exactly once', async () => {
  const { app, input } = await mount();
  try {
    const items = [
      { label: 'one', value: 1 },
      { label: 'two', value: 2 },
    ];

    let applied;
    let calls = 0;
    multiSelectList(app, 'review', items, (v) => {
      calls++;
      applied = v;
    }, { defaultAll: true });
    let box = openModalOn(app);

    clickRow(app, input, box, 1);
    await settle();
    assert.equal(calls, 0, 'moving the cursor is not an apply');

    clickRow(app, input, box, 1);
    await settle();
    assert.deepEqual(applied, [1, 2], 'the second click applied the checked set');
    assert.equal(calls, 1);

    // Same widget, keyboard path — `select` replaced key('enter') here, so
    // this guards against Enter firing the apply twice (list.js emits
    // `select` from enterSelected() on its own).
    calls = 0;
    applied = undefined;
    multiSelectList(app, 'review', items, (v) => {
      calls++;
      applied = v;
    }, { defaultAll: true });
    box = openModalOn(app);
    sendKey(input, 'space'); // uncheck the highlighted row — still key-only
    await settle(40);
    sendKey(input, 'enter');
    await settle();
    assert.deepEqual(applied, [2], 'Space still toggles, Enter still applies');
    assert.equal(calls, 1, 'and applies exactly once');
  } finally {
    cleanup(app);
  }
});

// The Calendar tab had no automated coverage at all before this. These two
// cover only what changed here (its panels' mouse/focus wiring and the grid
// row that had to be measurable for it), not the tab as a whole.

function calPanel(app, re) {
  return app.body.children.find((c) => c.visible && c._label && re.test(c._label.content || ''));
}

test('Calendar: clicking a day-session row previews it, clicking it again opens Detail', async () => {
  const { app, input } = await mount();
  try {
    // Two sessions dated today, so the calendar opens on a day that has a
    // list to click (it starts on today's date).
    const today = new Date().toISOString();
    for (const id of ['cal-1', 'cal-2']) {
      const n = emptyNeutral(id, 'claude');
      n.startedAt = today;
      n.turns = [{ role: 'user', text: `calendar ${id}` }];
      n.extracted.title = `calendar ${id}`;
      saveRaw(n);
    }
    reindex();

    sendKey(input, 'v');
    await settle(150);
    const dayList = calPanel(app, /\d{4}-\d{2}-\d{2}/);
    assert.ok(dayList, 'the Calendar tab is up with a day list');
    app.render();
    assert.equal(dayList.items.length, 2, "today's two sessions are listed");

    clickRow(app, input, dayList, 1);
    await settle();
    assert.equal(dayList.selected, 1, 'click moved the day-list cursor');

    clickRow(app, input, dayList, 1);
    await settle();
    const calDetail = calPanel(app, /Detail/);
    assert.equal(app.screen.focused, calDetail, 'second click drills into the calendar Detail panel');
  } finally {
    cleanup(app);
  }
});

test("Calendar: the month grid's first week lines up under the right weekday", async () => {
  const { app, input } = await mount();
  try {
    sendKey(input, 'v');
    await settle(150);
    const grid = calPanel(app, /Calendar/);
    assert.ok(grid, 'grid panel found');
    // Strip blessed's tag markup; the header and the first week's row have
    // to agree on a 3-column stride, or every day in that first row sits
    // one weekday early (the bug this asserts against).
    // Built rather than a literal: a raw ESC in a regex trips eslint's
    // no-control-regex, and getContent() hands back tags already converted
    // to real ANSI, not the `{...}` source.
    const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
    const lines = grid.getContent().replace(ansi, '').split('\n');
    const headerIdx = lines.findIndex((l) => l.includes('Su Mo Tu'));
    const firstWeek = lines[headerIdx + 1];
    const now = new Date();
    const firstDow = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
    assert.equal(
      firstWeek.indexOf('01'),
      firstDow * 3,
      `the 1st sits in weekday column ${firstDow}, at the same 3-column stride the header uses`,
    );
  } finally {
    cleanup(app);
  }
});
