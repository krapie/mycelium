import test from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from '../helpers.js';
import { createTestApp, sendKey } from '../tui-helpers.js';

// Regression coverage for a real bug (found by CodeRabbit review on PR #58,
// same class as folders-panel-e2e.test.js's fix for reloadFolders()): two
// sessions rendering byte-identical Sessions-panel rows (same title, same
// badges, no distinguishing snippet) could have their selection silently
// swapped by neo-blessed's own List.prototype.setItems(), which restores
// the cursor by matching the PREVIOUSLY selected row's rendered TEXT
// against the new items array — a content match, not an identity one.
// reloadList() runs after nearly every mutation, several of which can also
// resort the list, so restoring by the old numeric index alone (as
// reloadFolders()'s own fix does) isn't sufficient here — reloadList()
// instead tracks the actual session id across the rebuild. currentRow()
// (and therefore e/m/t/x/etc.) reads listBox.selected afterward, so getting
// this wrong meant a subsequent action could act on the wrong session. Real
// bytes on the input stream are required — see tui-helpers.js's module
// comment.

useTempHome();

const { createApp } = await import('../../src/tui/app.js');
const { sessionsView } = await import('../../src/tui/views/sessions.js');
const { saveRaw } = await import('../../src/scanner.js');
const { emptyNeutral } = await import('../../src/schema.js');
const { reindex } = await import('../../src/index-db.js');

function cleanup(app) {
  app.screen.destroy();
}

async function mountWithDuplicateRows() {
  // Same title, same source, same folder (so no [New]/lineage/link badge
  // differs either) — only id and startedAt differ, and startedAt isn't
  // rendered anywhere in the row, so the two rows are byte-identical.
  const a = emptyNeutral('session-aaaa', 'claude');
  a.turns = [{ role: 'user', text: 'work' }];
  a.extracted.title = 'Duplicate title';
  a.startedAt = '2026-01-02T00:00:00.000Z'; // newer -> row 0 under "recent"
  a.folder = 'work';
  saveRaw(a);

  const b = emptyNeutral('session-bbbb', 'claude');
  b.turns = [{ role: 'user', text: 'work' }];
  b.extracted.title = 'Duplicate title';
  b.startedAt = '2026-01-01T00:00:00.000Z'; // older -> row 1
  b.folder = 'work';
  saveRaw(b);
  reindex();

  const { input, output } = createTestApp();
  const app = createApp({ input, output });
  let api;
  await app.show(sessionsView({ onReady: (a2) => (api = a2) }));
  await new Promise((r) => setTimeout(r, 50));
  sendKey(input, 'right'); // focus onto the Sessions list
  await new Promise((r) => setTimeout(r, 30));
  return { app, input, api };
}

test('selecting the older of two identically-rendered rows survives a reloadList()', async () => {
  const { app, input, api } = await mountWithDuplicateRows();
  try {
    assert.equal(api.row.id, 'session-aaaa', 'sanity: starts on the newer row');

    sendKey(input, 'down'); // move onto session-bbbb (row 1)
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(api.row.id, 'session-bbbb', 'cursor is really on the older session');

    // Anything that calls reloadList() reproduces this — reloadAll() is the
    // simplest real trigger exposed on the API (same one e.g. a tag edit's
    // save path ultimately goes through).
    api.reloadAll();
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(api.row.id, 'session-bbbb', 'selection stayed on the same session across the reload, not silently swapped to its identical-looking sibling');
  } finally {
    cleanup(app);
  }
});
