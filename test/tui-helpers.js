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
