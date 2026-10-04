import test from 'node:test';
import assert from 'node:assert/strict';
import pkg from 'neo-blessed';
import { useTempHome } from './helpers.js';
import { createTestApp } from './tui-helpers.js';

const blessed = pkg.default || pkg;

useTempHome();
const { defaultTerminal, guardBottomRightCell } = await import('../src/tui/app.js');

test('defaultTerminal: Windows without TERM uses xterm-256color, not blessed\'s windows-ansi fallback', () => {
  assert.equal(defaultTerminal('win32', {}), 'xterm-256color');
});

test('defaultTerminal: an explicit TERM on Windows (Git Bash, ssh) is left alone', () => {
  assert.equal(defaultTerminal('win32', { TERM: 'xterm' }), undefined);
});

test('defaultTerminal: non-Windows platforms keep blessed\'s own TERM handling', () => {
  assert.equal(defaultTerminal('darwin', {}), undefined);
  assert.equal(defaultTerminal('linux', { TERM: 'screen-256color' }), undefined);
});

// A full-width, background-filled bottom row: exactly what made conhost scroll.
function renderBottomRow(guard) {
  const { input, output } = createTestApp({ columns: 40, rows: 10 });
  const screen = blessed.screen({ input, output, fullUnicode: true });
  if (guard) guardBottomRightCell(screen);
  blessed.box({ parent: screen, bottom: 0, left: 0, right: 0, height: 1, content: '한'.repeat(20), style: { bg: 'blue' } });
  screen.render();
  const row = screen.olines[screen.rows - 1];
  const cells = { last: row[screen.cols - 1].slice(), prev: row[screen.cols - 2].slice(), dattr: screen.dattr };
  screen.destroy();
  return cells;
}

test('guardBottomRightCell: the bottom-right cell is never written (it scrolls Windows conhost)', () => {
  const unguarded = renderBottomRow(false);
  assert.notDeepEqual(unguarded.last, [unguarded.dattr, ' '], 'sanity: unguarded, blessed does write the last cell');

  const guarded = renderBottomRow(true);
  assert.deepEqual(guarded.last, [guarded.dattr, ' ']);
  // The double-width char that would have spilled into the last column is blanked instead.
  assert.equal(guarded.prev[1], ' ');
});
