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
import { useTempHome } from './helpers.js';

useTempHome();

const { multiSelectLabel } = await import('../src/tui/widgets/pickers.js');
const { setLocale } = await import('../src/tui/i18n.js');

test('the checklist key hint follows the UI locale (#148)', () => {
  setLocale('ko');
  try {
    const label = multiSelectLabel('제안된 폴더 배치', { defaultAll: true });
    assert.match(label, /모두 선택됨/);
    assert.doesNotMatch(label, /all checked|enter apply/);
    assert.match(multiSelectLabel('지식 업데이트 검토', { defaultAll: true, preview: true }), /p 미리보기/);
  } finally {
    setLocale('en');
  }
  assert.match(multiSelectLabel('Review', { defaultAll: true, preview: true }), /all checked, space to uncheck, p preview, enter apply, esc cancel/);
  assert.match(multiSelectLabel('Pick'), /space select, \* all, enter apply/);
});

test('the summarize-stopped toast names the real cause instead of always blaming the usage limit', async () => {
  const { t } = await import('../src/tui/i18n.js');
  assert.match(t('smart.summarizeStoppedEarly', 2, 9, 'usage limit reached'), /usage limit/);
  assert.match(t('smart.summarizeStoppedEarly', 2, 9, 'stdin is not a terminal'), /re-authentication/);
  const other = t('smart.summarizeStoppedEarly', 2, 9, 'llm timeout');
  assert.match(other, /llm timeout/);
  assert.doesNotMatch(other, /usage limit/);
});

test('the summarize-stopped toast says when the agent CLI is missing', async () => {
  const { t } = await import('../src/tui/i18n.js');
  assert.match(t('smart.summarizeStoppedEarly', 0, 5, 'LLM failed: claude not installed'), /not found on PATH/);
});
