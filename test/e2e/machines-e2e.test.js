/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from '../helpers.js';
import { createTestApp, sendKey } from '../tui-helpers.js';

// Shift+H on a store synced across machines: the @machine badges, the filter
// picker, and that changing the filter drops the multi-selection (selected ids
// are store-wide, so ones the new filter hides would still be what x/m/t act on).
// Real bytes on the input stream — see tui-helpers.js's module comment.

useTempHome();

const { createApp } = await import('../../src/tui/app.js');
const { sessionsView } = await import('../../src/tui/views/sessions.js');
const { saveRaw } = await import('../../src/scanner.js');
const { emptyNeutral } = await import('../../src/schema.js');
const { reindex } = await import('../../src/index-db.js');
const { loadConfig, saveConfig } = await import('../../src/config.js');

const pause = (ms = 80) => new Promise((r) => setTimeout(r, ms));

async function mount() {
  saveConfig({ ...loadConfig(), machineName: 'macbook', sync: { remote: '/nowhere.git', mode: 'push' } });
  for (const [id, host, startedAt, title] of [
    ['mac-1', 'macbook', '2026-01-02T00:00:00.000Z', 'Local work'],
    ['srv-1', 'homeserver', '2026-01-01T00:00:00.000Z', 'Server work'],
  ]) {
    const n = emptyNeutral(id, 'claude');
    n.turns = [{ role: 'user', text: `work on ${id}` }];
    n.startedAt = startedAt;
    n.host = host;
    n.extracted.title = title;
    saveRaw(n);
  }
  reindex();

  const { input, output } = createTestApp();
  const app = createApp({ input, output });
  await app.show(sessionsView({}));
  await pause(50);
  sendKey(input, 'right'); // focus the Sessions list
  await pause(30);
  const listBox = app.body.children.find((c) => c._label && /Sessions/.test(c._label.content) && c.type === 'list');
  return { app, input, listBox };
}

const rows = (listBox) => listBox.items.map((it) => it.content);

async function pickMachine(input, app, optionIndex) {
  sendKey(input, 'H'); // Shift+H
  await pause();
  const picker = app.screen.children.find((c) => c.type === 'list' && /Show sessions from/.test(c._label?.content || ''));
  assert.ok(picker, 'Shift+H opened the machine picker');
  picker.select(optionIndex);
  sendKey(input, 'enter');
  await pause();
}

test('Shift+H filters the list to one machine, badges tell them apart, and the selection is dropped', async () => {
  const { app, input, listBox } = await mount();
  try {
    const all = rows(listBox);
    assert.equal(all.length, 2);
    assert.match(all[0], /Local work.*@macbook/);
    assert.match(all[1], /Server work.*@homeserver/);

    sendKey(input, 'space'); // select the first row (Local work)
    await pause();
    assert.match(rows(listBox)[0], /✓/);

    await pickMachine(input, app, 1); // [All, homeserver, macbook (this machine)] -> homeserver
    const filtered = rows(listBox);
    assert.equal(filtered.length, 1);
    assert.match(filtered[0], /Server work/);
    assert.doesNotMatch(filtered[0], /✓/);

    await pickMachine(input, app, 0); // back to All machines
    const back = rows(listBox);
    assert.equal(back.length, 2);
    assert.doesNotMatch(back.join('\n'), /✓/, 'the selection made before the filter is gone, not just hidden');
  } finally {
    app.screen.destroy();
  }
});
