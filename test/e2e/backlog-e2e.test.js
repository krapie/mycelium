import test from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from '../helpers.js';
import { createTestApp, sendKey, sendKeys, waitFor } from '../tui-helpers.js';

// Coverage for the backlog feature (issue #113): `b` writes an intent note
// into the folder you're browsing, and `r` on that note launches an agent
// seeded with it. Real bytes on the input stream (not synthetic keypress
// objects) are required — see tui-helpers.js's module comment.
//
// MYCELIUM_DEMO_MODE makes launch.js's agent picker list every adapter even
// on a machine with no agent CLI installed (its own documented reason), which
// is what lets the open-the-item flow be driven at all here; the flow is then
// steered onto the "copy command" branch, so nothing is ever foregrounded.
process.env.MYCELIUM_DEMO_MODE = '1';

useTempHome();

const { createApp } = await import('../../src/tui/app.js');
const { sessionsView } = await import('../../src/tui/views/sessions.js');
const { allRaw, loadRaw } = await import('../../src/scanner.js');
const { mkdir } = await import('../../src/organize.js');
const { createBacklog } = await import('../../src/backlog.js');
const { reindex } = await import('../../src/index-db.js');
const { __setTestClipboard } = await import('../../src/tui/clipboard.js');

// The open-the-item flow below takes the "copy command" branch (the only one
// that doesn't foreground a real agent), which really would write to the
// clipboard of whoever runs the suite — capture it here instead, which also
// lets the test assert what the pasted command would actually carry.
let copied = null;
__setTestClipboard((text) => {
  copied = text;
  return true;
});

function cleanup(app) {
  app.screen.destroy();
}

async function mount(folder = 'Later') {
  mkdir(folder);
  reindex();
  const { input, output } = createTestApp();
  const app = createApp({ input, output });
  await app.show(sessionsView({}));
  await new Promise((r) => setTimeout(r, 50));
  const foldersBox = app.body.children.find((c) => c.type === 'list' && /Folders|폴더/.test(c._label?.content || ''));
  const listBox = app.body.children.find((c) => c._label && /Sessions/.test(c._label.content) && c.type === 'list');
  return { app, input, foldersBox, listBox };
}

/** Drill into `folder` from the folders panel. Counted from the panel's own
 * row keys rather than a fixed number of downs, so a test doesn't silently
 * depend on how many folders the tests before it happened to create. */
async function drillInto(input, foldersBox, folder) {
  const idx = foldersBox._keys.indexOf(folder);
  assert.ok(idx > 0, `${folder} is in the folders panel`);
  await sendKeys(input, Array(idx).fill('down'), 40);
  sendKey(input, 'enter');
  await new Promise((r) => setTimeout(r, 60));
}

const backlogItems = () => allRaw().filter((n) => n.kind === 'backlog');

test('b writes a titled+described backlog item into the folder being browsed, and it shows up as a row', async () => {
  const { app, input, foldersBox, listBox } = await mount('Later');
  try {
    await drillInto(input, foldersBox, 'Later');

    sendKey(input, 'b');
    await new Promise((r) => setTimeout(r, 80));
    await sendKeys(input, ['s', 'h', 'i', 'p', ' ', 'i', 't'], 15);
    sendKey(input, 'enter');
    await new Promise((r) => setTimeout(r, 80));
    await sendKeys(input, ['n', 'o', 't', 'e', 's'], 15);
    sendKey(input, 'enter');

    await waitFor(() => backlogItems().length === 1);
    const item = backlogItems()[0];
    assert.equal(item.extracted.title, 'ship it');
    assert.equal(item.extracted.summary, 'notes');
    assert.equal(item.folder, 'Later');
    assert.equal(item.organizedBy, 'human');
    assert.deepEqual(item.turns, []);

    await waitFor(() => listBox.items.some((it) => /ship it/.test(it.content)));
    const row = listBox.items.find((it) => /ship it/.test(it.content)).content;
    assert.match(row, /Backlog/, 'the row is badged as a backlog item');
    assert.doesNotMatch(row, /#claude/, 'no agent hashtag — no agent has been chosen yet');

    // Regression: sort-by-agent compares sourceLabel()s, and a backlog item
    // has no source — that comparator used to throw on the null it got back.
    await sendKeys(input, ['O', 'O', 'O'], 60); // Shift+O cycles recent → title → agent
    assert.ok(listBox.items.some((it) => /ship it/.test(it.content)), 'the list still renders sorted by agent');
  } finally {
    cleanup(app);
  }
});

test('r on a backlog item launches an agent seeded with it and marks it done', async () => {
  // Its own fixture, in its own folder — this test must pass on a filtered run
  // that never executes the one above.
  const item = createBacklog({ title: 'paste me', description: 'notes', folder: 'Queue' }).session;
  const { app, input, foldersBox, listBox } = await mount('Queue');
  try {
    await drillInto(input, foldersBox, 'Queue');
    await waitFor(() => listBox.items.some((it) => /paste me/.test(it.content)));

    sendKey(input, 'r');
    // Agent picker → "copy command" (never "open here": that would foreground
    // a real agent subprocess).
    await waitFor(() => app.screen.children.some((c) => c.type === 'list' && /agent/i.test(c._label?.content || '')));
    sendKey(input, 'enter'); // first agent
    // No session has ever run in this folder, so resolveDir() (launch.js) has
    // no directory suggestions to offer and goes straight to its type-prompt,
    // prefilled with process.cwd() — accept it as-is.
    await waitFor(() => app.screen.children.some((c) => c.type === 'prompt'));
    // blessed's prompt wires its textbox's readInput() a tick after the widget
    // itself is on screen — an Enter that lands before that is simply dropped.
    await new Promise((r) => setTimeout(r, 150));
    sendKey(input, 'enter');

    await waitFor(() => app.screen.children.some((c) => c.type === 'list' && c.items?.some((it) => /copy/i.test(it.content))));
    const chooser = app.screen.children.find((c) => c.type === 'list' && c.items?.some((it) => /copy/i.test(it.content)));
    chooser.select(chooser.items.findIndex((it) => /copy/i.test(it.content)));
    sendKey(input, 'enter');

    await waitFor(() => loadRaw(item.id).doneAt !== null);
    assert.ok(loadRaw(item.id).doneAt, 'entering the item is what marks it done');
    // What actually reaches the other terminal is what associates the session
    // started there back to this item (scanner.js redeems the marker on that
    // session's first import).
    assert.match(copied, /paste me/, 'the copied command carries the item as the agent prompt');
    assert.match(copied, new RegExp(`mycelium:backlog:${item.id}`), 'and the marker that links the session back');
  } finally {
    cleanup(app);
  }
});
