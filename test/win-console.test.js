import test from 'node:test';
import assert from 'node:assert/strict';
import pkg from 'neo-blessed';
import { useTempHome } from './helpers.js';
import { createTestApp } from './tui-helpers.js';

const blessed = pkg.default || pkg;

useTempHome();
// For its Tput patch: silences blessed's xterm-256color Setulc compile error.
await import('../src/tui/app.js');
const { defaultTerminal, guardBottomRightCell, ambiguousIsWide, widenAmbiguousChars } = await import('../src/tui/win-console.js');

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

test('ambiguousIsWide: only a plain conhost window on a CJK code page', () => {
  const cp = (n) => () => n;
  assert.equal(ambiguousIsWide('win32', {}, cp(949)), true);
  assert.equal(ambiguousIsWide('win32', {}, cp(932)), true);
  assert.equal(ambiguousIsWide('win32', {}, cp(437)), false);
  assert.equal(ambiguousIsWide('win32', {}, cp(65001)), false);
  assert.equal(ambiguousIsWide('win32', { WT_SESSION: 'x' }, cp(949)), false, 'Windows Terminal');
  assert.equal(ambiguousIsWide('win32', { TERM_PROGRAM: 'vscode' }, cp(949)), false, 'VS Code');
  assert.equal(ambiguousIsWide('darwin', {}, cp(949)), false);
  assert.equal(ambiguousIsWide('darwin', { MYCELIUM_AMBIGUOUS_WIDE: '1' }, cp(437)), true);
  assert.equal(ambiguousIsWide('win32', { MYCELIUM_AMBIGUOUS_WIDE: '0' }, cp(949)), false);
});

// Runs last: the patch is module-global for the rest of this process.
test('widenAmbiguousChars: ambiguous chars take two cells, line-drawing (ACS) chars stay one', () => {
  const { input, output } = createTestApp({ columns: 40, rows: 10 });
  const screen = blessed.screen({ input, output, fullUnicode: true, terminal: 'xterm-256color', extended: false });
  widenAmbiguousChars(screen);
  const { unicode } = blessed;
  assert.equal(unicode.strWidth('a…b'), 4);
  assert.equal(unicode.strWidth('→ “x”'), 8);
  assert.equal(unicode.strWidth('한'), 2, 'real wide chars unchanged');
  assert.equal(unicode.strWidth('·─│'), 3, 'drawn through the DEC line-drawing charset');

  // Layout reserves the extra cell, so text after an ambiguous char lands where conhost draws it.
  const box = blessed.box({ parent: screen, top: 0, left: 0, width: 20, height: 1, content: 'a…b' });
  screen.render();
  const row = screen.lines[0];
  assert.equal(row[0][1], 'a');
  assert.equal(row[1][1], '…');
  assert.equal(row[3][1], 'b');
  box.destroy();
  screen.destroy();
});
