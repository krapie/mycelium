import { PassThrough } from 'node:stream';

// Drives the REAL TUI (real app.js/sessions.js/tutorial.js handlers, real
// data layer) against fake streams instead of a real TTY — no tmux, no
// pty. The key finding this relies on: writing REAL BYTES to the input
// stream (not synthetic event objects) is required. neo-blessed's own
// key() bindings (src/tui/views/sessions.js's screenKey helper, every
// element.key() call) listen for a `program`-level `'key <name>'` event
// that's only emitted from real keypress parsing on the input stream
// (see node_modules/neo-blessed/lib/program.js — keys.emitKeypressEvents
// (this.input), then `program.emit('key ' + name, ...)` inside that
// stream's own 'keypress' handler). A bare `screen.emit('keypress', ...)`
// never reaches those bindings, only tutorial.js's own raw
// `screen.on('keypress', ...)` listener — so it would silently test half
// the real app and none of sessions.js's actual key handlers.

// ANSI sequences for the non-printable keys the demo/tutorial actually
// uses. Extend as needed — anything not listed here just gets sent as its
// literal character(s) (letters, digits, '*', etc. all work as-is).
const SEQUENCES = {
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
  enter: '\r',
  escape: '\x1b',
  space: ' ',
};

/**
 * Builds a real `createApp()` app against a fake input/output stream pair.
 * `columns`/`rows` should stay generous (the real 3-column layout truncates
 * content at narrow widths) — 220x50 matches what this repo's own manual
 * tmux verification has used throughout development.
 */
export function createTestApp({ columns = 220, rows = 50 } = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  output.columns = columns;
  output.rows = rows;
  output.isTTY = true;
  // Output is never read in these tests (no pixel/ANSI assertions — see
  // demo-e2e.test.js's module comment for why) but still needs to drain,
  // or blessed's writes to it will eventually back up and block.
  output.on('data', () => {});

  return { input, output };
}

/**
 * Sends one logical keypress as real bytes on the input stream. `name` is
 * either a key from SEQUENCES (arrows, enter, escape, space) or a literal
 * single character to type as-is (e.g. 'o', 'w', 'S' for Shift+S — a
 * literal uppercase letter arrives with `key.shift: true` from real
 * keypress parsing, exactly like a real terminal, which is what the
 * merge/split steps' `shift: true` matching depends on — see tutorial.js).
 */
export function sendKey(input, name) {
  input.write(SEQUENCES[name] ?? name);
}

// Mouse works through the same real-bytes seam as keys, and for the same
// reason: neo-blessed parses mouse out of the input stream itself
// (program.js's bindMouse() subscribes to the program's own 'data' event,
// which _listenInput() re-emits from `this.input.on('data')`), so an SGR
// sequence written to the PassThrough reaches screen._listenMouse()'s
// hit-testing exactly like a real terminal's would. Nothing here needs a
// TTY or a real mouse. The one gotcha: blessed's `zero` option defaults on,
// so it decrements the coordinates it parses — these helpers take 0-based
// screen coordinates (what `element.lpos.xi`/`.yi` report) and send the
// 1-based ones a terminal would.
//
// Mouse events only arrive at all once something has enabled tracking —
// screen._listenMouse() calls program.enableMouse() the first time any
// element opts in (`mouse: true`/`clickable: true`/a mouse listener). The
// real TUI always has such an element on screen, so this is never a
// precondition a test has to arrange.
function sgrMouse(button, x, y, press) {
  return `\x1b[<${button};${x + 1};${y + 1}${press ? 'M' : 'm'}`;
}

/**
 * One left click at 0-based screen coordinates. blessed only emits `click`
 * on the mouseup (screen.js's `(self.mouseDown || el).emit('click', data)`),
 * so both halves have to go out — a lone press is a mousedown, not a click.
 */
export function sendClick(input, x, y) {
  input.write(sgrMouse(0, x, y, true));
  input.write(sgrMouse(0, x, y, false));
}

/** One wheel notch at 0-based screen coordinates. `dir` is 'up' or 'down'. */
export function sendWheel(input, dir, x, y) {
  input.write(sgrMouse(dir === 'up' ? 64 : 65, x, y, true));
}

export async function sendKeys(input, names, delayMs = 20) {
  for (const name of names) {
    sendKey(input, name);
    // Deliberately sequential: each keypress needs to be fully processed
    // (readline parsing + the real handler it triggers) before the next
    // one arrives, same as a human typing.
    await wait(delayMs);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls `check()` until it returns truthy, or throws after `timeoutMs`.
 * Same shape as tutorial.js's own pollUntil()/isModalOpen() — real
 * handlers here are async (even the mocked LLM calls resolve on a later
 * tick), so a fixed delay is either too short (flaky) or wastefully long;
 * polling is what the app's own code already does for exactly this reason.
 */
export async function waitFor(check, { timeoutMs = 2000, intervalMs = 20 } = {}) {
  const start = Date.now();
  for (;;) {
    const result = check();
    if (result) return result;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor() timed out after ${timeoutMs}ms`);
    }
    await wait(intervalMs);
  }
}
