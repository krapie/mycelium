import { spawn } from 'node:child_process';

/**
 * Run a full-screen program in the foreground and cleanly return to the TUI.
 * blessed's own screen.exec left the two UIs merged; a bare leave/enter fixed
 * the launch but broke the return (input raw-mode + mouse weren't restored).
 * This replicates blessed's full spawn suspend/resume: exit the alt buffer and
 * hand over raw stdin, then on exit restore raw-mode/mouse/alt-buffer and force
 * a full redraw. Shared by agent launch/resume and the $EDITOR-based content
 * editor — anything that needs to hand the real terminal to a child process.
 */
export function foreground(app, bin, args, cwd, after) {
  const screen = app.screen;
  const program = screen.program;
  const input = program.input;
  const mouseWasOn = program.mouseEnabled;

  // --- suspend blessed, give the raw terminal to the child ---
  try {
    program.saveCursor();
    program.normalBuffer(); // leave alternate screen
    program.showCursor();
    if (mouseWasOn) program.disableMouse();
    if (input.setRawMode) input.setRawMode(false);
    input.pause();
  } catch {
    /* ignore */
  }

  let resumed = false;
  const resume = () => {
    if (resumed) return;
    resumed = true;
    try {
      input.resume();
      if (input.setRawMode) input.setRawMode(true);
      program.alternateBuffer(); // re-enter alternate screen
      program.hideCursor();
      if (mouseWasOn) program.enableMouse();
      if (typeof screen.alloc === 'function') screen.alloc(); // blank buffer → full redraw
    } catch {
      /* ignore */
    }
    try {
      after();
    } finally {
      screen.render();
    }
  };

  let child;
  try {
    child = spawn(bin, args, { cwd, stdio: 'inherit' });
  } catch {
    return resume();
  }
  child.on('error', resume);
  child.on('exit', resume);
}
