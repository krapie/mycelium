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
