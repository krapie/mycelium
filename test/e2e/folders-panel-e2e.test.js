import test from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from '../helpers.js';
import { createTestApp, sendKey, sendKeys } from '../tui-helpers.js';

// Regression coverage for a real bug: two folders sharing a leaf name under
// different parents (e.g. cases/CW and projects/CW) rendered identical rows
// in the Folders panel whenever neither was the "current" one (same dim
// color, same leaf, same count) — see sessions.js's reloadFolders() for the
// full root-cause writeup. neo-blessed's List.prototype.setItems() tries to
// keep the cursor on "the same item" across every reloadFolders() call
// (previewFolder()'s live-preview fires on every up/down keystroke) by
// matching the PREVIOUSLY selected row's rendered TEXT against the new
// items array — a content match, not an index one. Once two rows render
// byte-identical, that heuristic can silently relocate the cursor to the
// OTHER same-named folder, so a subsequent rename/move/delete acts on the
// wrong one. Real bytes on the input stream (not synthetic keypress
// objects) are required — see tui-helpers.js's module comment.

useTempHome();

const { createApp } = await import('../../src/tui/app.js');
const { sessionsView } = await import('../../src/tui/views/sessions.js');
const { saveRaw, allRaw } = await import('../../src/scanner.js');
const { emptyNeutral } = await import('../../src/schema.js');
const { reindex } = await import('../../src/index-db.js');
const { mkdir } = await import('../../src/organize/folders.js');

function cleanup(app) {
  app.screen.destroy();
}

function findFoldersBox(app) {
  return app.body.children.find((c) => c._label && /Folders/.test(c._label.content));
}

async function mountWithSameLeafFolders() {
  mkdir('cases/CW');
  mkdir('projects/CW');
  // Same session count (1) in both — their DIM (not-current) rendering is
  // byte-identical: same indent, same leaf "CW", same color, same count.
  // That identical text is exactly what trips setItems()'s own heuristic.
  const a = emptyNeutral('cases-cw-0', 'claude');
  a.folder = 'cases/CW';
  a.turns = [{ role: 'user', text: 'cases cw session' }];
  saveRaw(a);
  const b = emptyNeutral('projects-cw-0', 'claude');
  b.folder = 'projects/CW';
  b.turns = [{ role: 'user', text: 'projects cw session' }];
  saveRaw(b);
  reindex();

  const { input, output } = createTestApp();
  const app = createApp({ input, output });
  let api;
  await app.show(sessionsView({ onReady: (a2) => (api = a2) }));
  await new Promise((r) => setTimeout(r, 50));
  return { app, input, api, foldersBox: findFoldersBox(app) };
}

test('navigating onto a folder whose sibling shares its leaf name lands on the CORRECT one', async () => {
  const { app, input, foldersBox } = await mountWithSameLeafFolders();
  try {
    // Rows: 0 Root, 1 New, 2 cases, 3 cases/CW, 4 projects, 5 projects/CW.
    // The critical step is 2 (on "cases", both CW rows still dim+identical)
    // -> 3 (lands on cases/CW) — before the fix this silently relocated the
    // real cursor to row 5 (projects/CW) instead.
    await sendKeys(input, ['down', 'down', 'down'], 60);
    assert.equal(foldersBox._keys[foldersBox.selected], 'cases/CW', 'cursor is really on cases/CW, not projects/CW');

    // Continue past it and confirm projects/CW is still reachable and
    // correctly identified too — the fix shouldn't just special-case the
    // first collision.
    await sendKeys(input, ['down', 'down'], 60);
    assert.equal(foldersBox._keys[foldersBox.selected], 'projects/CW', 'cursor reaches projects/CW correctly too');
  } finally {
    cleanup(app);
  }
});

test('renaming the folder the cursor is really on affects only that folder, not its same-named sibling', async () => {
  const { app, input, foldersBox } = await mountWithSameLeafFolders();
  try {
    await sendKeys(input, ['down', 'down', 'down'], 60);
    assert.equal(foldersBox._keys[foldersBox.selected], 'cases/CW');

    sendKey(input, 'e'); // rename in place — the prompt prefills with the current path
    await new Promise((r) => setTimeout(r, 80));
    // Append rather than clear-and-retype (no 'backspace' entry in
    // tui-helpers.js's SEQUENCES, and this proves the same point: whichever
    // folder's path the prompt was prefilled with is the one that renames).
    await sendKeys(input, ['-', 'r', 'e', 'n', 'a', 'm', 'e', 'd'], 15);
    sendKey(input, 'enter');
    await new Promise((r) => setTimeout(r, 150));

    assert.equal(allRaw().find((n) => n.id === 'cases-cw-0').folder, 'cases/CW-renamed', 'cases/CW is the one that actually renamed');
    assert.equal(allRaw().find((n) => n.id === 'projects-cw-0').folder, 'projects/CW', 'projects/CW was never touched');
  } finally {
    cleanup(app);
  }
});
