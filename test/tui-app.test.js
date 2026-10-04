import test from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers.js';

useTempHome();
const { defaultTerminal } = await import('../src/tui/app.js');

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
