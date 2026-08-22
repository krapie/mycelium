import test from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from '../helpers.js';
import { createTestApp, sendKey } from '../tui-helpers.js';

// Coverage for issue #51: a direct sort picker (Shift+T) in the Sessions
// panel, alongside the existing Shift+O blind cycle (left untouched — see
// sessions.js's own comment on why the two entry points are independent).
// Real bytes on the input stream (not synthetic keypress objects) are
// required — see tui-helpers.js's module comment.

useTempHome();

const { createApp } = await import('../../src/tui/app.js');
const { sessionsView } = await import('../../src/tui/views/sessions.js');
const { saveRaw } = await import('../../src/scanner.js');
const { emptyNeutral } = await import('../../src/schema.js');
const { reindex } = await import('../../src/index-db.js');

function cleanup(app) {
  app.screen.destroy();
}

// 3 sessions, deliberately out of both date order and alphabetical order,
// so each of the 4 sort modes produces a distinct, checkable arrangement.
const SPECS = [
  { id: 'b-session', title: 'Banana work', startedAt: '2026-01-02T00:00:00.000Z' },
  { id: 'a-session', title: 'Apple work', startedAt: '2026-01-03T00:00:00.000Z' },
  { id: 'c-session', title: 'Cherry work', startedAt: '2026-01-01T00:00:00.000Z' },
];

async function mountWithSortableSessions() {
  for (const s of SPECS) {
    const n = emptyNeutral(s.id, 'claude');
    n.turns = [{ role: 'user', text: 'x' }];
    n.startedAt = s.startedAt;
    n.extracted.title = s.title;
    saveRaw(n);
  }
  reindex();

  const { input, output } = createTestApp();
  const app = createApp({ input, output });
  let api;
  await app.show(sessionsView({ onReady: (a) => (api = a) }));
  await new Promise((r) => setTimeout(r, 50));
  sendKey(input, 'right'); // focus onto the Sessions list
  await new Promise((r) => setTimeout(r, 30));

  const listBox = app.body.children.find((c) => c._label && /Sessions/.test(c._label.content) && c.type === 'list');
  return { app, input, api, listBox };
}

function titleOrder(listBox) {
  return listBox.items.map((it) => (it.content.match(/(Apple|Banana|Cherry) work/) || [])[1]).filter(Boolean);
}

async function pickSort(input, app, optionIndex) {
  sendKey(input, 'T'); // Shift+T
  await new Promise((r) => setTimeout(r, 80));
  const pickerBox = app.screen.children.find((c) => c.type === 'list' && /Sort by/.test(c._label?.content || ''));
  assert.ok(pickerBox, 'Shift+T opened the sort picker');
  pickerBox.select(optionIndex);
  sendKey(input, 'enter');
  await new Promise((r) => setTimeout(r, 80));
}

test('Shift+T opens a picker with all 4 sort options, each reorders the list correctly', async () => {
  const { app, input, listBox } = await mountWithSortableSessions();
  try {
    assert.deepEqual(titleOrder(listBox), ['Apple', 'Banana', 'Cherry'], 'initial order is recent (DB-ordered, most recent first)');

    await pickSort(input, app, 1); // Oldest first
    assert.deepEqual(titleOrder(listBox), ['Cherry', 'Banana', 'Apple'], 'date-asc: oldest startedAt first');

    await pickSort(input, app, 2); // Title A-Z
    assert.deepEqual(titleOrder(listBox), ['Apple', 'Banana', 'Cherry'], 'title: alphabetical');

    await pickSort(input, app, 3); // Title Z-A
    assert.deepEqual(titleOrder(listBox), ['Cherry', 'Banana', 'Apple'], 'title-desc: reverse alphabetical');

    await pickSort(input, app, 0); // Newest first
    assert.deepEqual(titleOrder(listBox), ['Apple', 'Banana', 'Cherry'], 'recent: back to most-recent-first');
  } finally {
    cleanup(app);
  }
});

test('Shift+T picker: Escape leaves the current sort order untouched', async () => {
  const { app, input, listBox } = await mountWithSortableSessions();
  try {
    await pickSort(input, app, 2); // Title A-Z first, so there's a non-default order to preserve
    assert.deepEqual(titleOrder(listBox), ['Apple', 'Banana', 'Cherry']);

    sendKey(input, 'T');
    await new Promise((r) => setTimeout(r, 80));
    const pickerBox = app.screen.children.find((c) => c.type === 'list' && /Sort by/.test(c._label?.content || ''));
    assert.ok(pickerBox, 'picker opened');
    sendKey(input, 'escape');
    await new Promise((r) => setTimeout(r, 80));

    assert.deepEqual(titleOrder(listBox), ['Apple', 'Banana', 'Cherry'], 'order unchanged after cancelling the picker');
  } finally {
    cleanup(app);
  }
});

test('Shift+O\'s existing blind cycle still works unchanged alongside the new Shift+T picker', async () => {
  const { app, input, listBox } = await mountWithSortableSessions();
  try {
    // recent -> title (A-Z) -> agent -> recent, same as before this feature.
    sendKey(input, 'O'); // Shift+O
    await new Promise((r) => setTimeout(r, 80));
    assert.deepEqual(titleOrder(listBox), ['Apple', 'Banana', 'Cherry'], 'Shift+O: recent -> title A-Z, unchanged');
  } finally {
    cleanup(app);
  }
});
