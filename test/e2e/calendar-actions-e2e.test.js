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

useTempHome();

const { createApp } = await import('../../src/tui/app.js');
const { sessionsView } = await import('../../src/tui/views/sessions.js');
const { saveRaw } = await import('../../src/scanner.js');
const { emptyNeutral } = await import('../../src/schema.js');
const { reindex } = await import('../../src/index-db.js');
const { __setTestClipboard } = await import('../../src/tui/clipboard.js');

let lastCopiedText = null;
__setTestClipboard((text) => {
  lastCopiedText = text;
  return true;
});

function cleanup(app) {
  app.screen.destroy();
}

async function mountCalendarWithSession() {
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  const a = emptyNeutral('cal-sess-1', 'claude');
  a.startedAt = `${dateStr}T12:00:00.000Z`;
  a.extracted.title = 'Calendar Action Session';
  a.turns = [{ role: 'user', text: 'Hello calendar' }];
  saveRaw(a);
  reindex();

  const { input, output } = createTestApp();
  const app = createApp({ input, output });
  let api;
  await app.show(sessionsView({ onReady: (a2) => (api = a2) }));
  await new Promise((r) => setTimeout(r, 50));
  return { app, input, api, dateStr };
}

test('Calendar day-list binds `.`, `y`, `space`, and `x` for per-session actions (#121)', async () => {
  const { app, input, dateStr } = await mountCalendarWithSession();
  try {
    // 1. Toggle to Calendar tab with `v`
    sendKey(input, 'v');
    await new Promise((r) => setTimeout(r, 60));

    // 2. Drill into day list with Enter
    sendKey(input, 'enter');
    await new Promise((r) => setTimeout(r, 60));

    // 3. Test `.` action menu opens
    sendKey(input, '.');
    await new Promise((r) => setTimeout(r, 60));
    const menuBox = app.screen.children.find((c) => c.type === 'list' && /want to do/i.test(c._label?.content || ''));
    assert.ok(menuBox, 'Action menu opened from calendar day list');

    // Close menu with Escape
    sendKey(input, 'escape');
    await new Promise((r) => setTimeout(r, 60));

    // 4. Test `y` copies session transcript to clipboard
    lastCopiedText = null;
    sendKey(input, 'y');
    await new Promise((r) => setTimeout(r, 60));
    assert.ok(lastCopiedText && lastCopiedText.includes('Calendar Action Session'), 'Session copied to clipboard with y');

    // 5. Test `space` toggles selection
    const dayListBox = app.body.children.find((c) => c.type === 'list' && c._label && new RegExp(dateStr).test(c._label.content));
    assert.ok(dayListBox, 'Found day list box');
    const contentBefore = dayListBox.items[0].content;
    assert.ok(!contentBefore.includes('✓'), 'Not selected initially');

    sendKey(input, 'space');
    await new Promise((r) => setTimeout(r, 60));
    assert.ok(dayListBox.items[0].content.includes('✓'), 'Selection mark appears after pressing space');

    // 6. Test `x` opens delete confirmation
    sendKey(input, 'x');
    await new Promise((r) => setTimeout(r, 60));
    const deleteMenu = app.screen.children.find((c) => c.type === 'list' && /Delete/i.test(c._label?.content || ''));
    assert.ok(deleteMenu, 'Delete confirmation dialog opened');

    // Cancel delete with Escape
    sendKey(input, 'escape');
    await new Promise((r) => setTimeout(r, 60));
  } finally {
    cleanup(app);
  }
});
