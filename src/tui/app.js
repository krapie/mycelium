import pkg from 'neo-blessed';
const blessed = pkg.default || pkg;
import { C } from './theme.js';
import { t } from './i18n.js';

// blessed mis-compiles some xterm-256color capabilities (notably `Setulc`,
// set-underline-color) into JS with a syntax error, then dumps the generated
// source to the terminal via console.error and rethrows. We don't use those
// capabilities, so wrap the compiler to swallow the dump and return a no-op
// for any capability that fails to compile. Must run before any screen is made.
(function patchTput() {
  const Tput = blessed.Tput;
  if (!Tput || !Tput.prototype || Tput.prototype.__myceliumPatched) return;
  const orig = Tput.prototype._compile;
  Tput.prototype._compile = function (info, key, str) {
    const origErr = console.error;
    console.error = () => {};
    try {
      return orig.call(this, info, key, str);
    } catch {
      return function () {
        return '';
      };
    } finally {
      console.error = origErr;
    }
  };
  Tput.prototype.__myceliumPatched = true;
})();

/**
 * The TUI shell: a full-screen blessed screen with a header (breadcrumb +
 * counts), a body that hosts the active view, and a statusbar of key hints.
 * Views are swapped in/out of `body`; each view owns its own widgets and
 * keybindings and exposes { mount, unmount, help }.
 */
export function createApp() {
  const screen = blessed.screen({
    smartCSR: true,
    title: 'Mycelium',
    fullUnicode: true,
    autoPadding: true,
    // blessed mis-compiles the xterm-256color `Setulc` (underline-color)
    // capability and dumps the generated JS to the terminal on exit. We don't
    // use underline colors, so skip extended terminfo entirely to avoid it.
    extended: false,
  });

  // Belt-and-suspenders: neutralize the broken capability if it slipped through.
  try {
    const tput = screen.program && screen.program.tput;
    if (tput) for (const k of ['setulc', 'Su', 'setUnderlineColor']) if (typeof tput[k] === 'function') tput[k] = () => '';
  } catch {
    /* ignore */
  }

  const header = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    tags: true,
    padding: { left: 1, right: 1 },
    border: { type: 'line' },
    style: { fg: C.text, border: { fg: C.border } },
  });

  const body = blessed.box({
    parent: screen,
    top: 3,
    left: 0,
    right: 0,
    bottom: 1,
  });

  const statusbar = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    right: 0,
    height: 1,
    tags: true,
    padding: { left: 1, right: 1 },
    style: { fg: C.dim },
  });

  const toast = blessed.message({
    parent: screen,
    top: 'center',
    left: 'center',
    width: '50%',
    height: 'shrink',
    border: { type: 'line' },
    style: { border: { fg: C.fox }, fg: C.text },
    hidden: true,
  });

  const app = {
    screen,
    body,
    _view: null,
    setHeader(breadcrumb, right = '') {
      header.setContent(
        `{bold}{${C.fox}-fg}mycelium{/} {${C.faint}-fg}·{/} ${breadcrumb}` +
          (right ? `{|}{${C.dim}-fg}${right}{/}` : ''),
      );
      screen.render();
    },
    setStatus(hints) {
      statusbar.setContent(` ${hints}`);
      screen.render();
    },
    notify(msg, seconds = 2) {
      toast.display(msg, seconds, () => {});
    },
    // Dismiss a long-duration progress toast (e.g. notify(msg, 60)) right
    // before opening a modal — blessed.message's own auto-hide timer doesn't
    // fire early, so without this a toast still mid-countdown visibly
    // overlaps whatever opens next (both are centered overlays). See
    // launch.js's launchAgent() `title` param for the same class of bug.
    dismissNotify() {
      toast.hide();
      screen.render();
    },
    async show(view) {
      if (app._view && app._view.unmount) app._view.unmount();
      body.children.slice().forEach((c) => c.detach());
      app._view = view;
      await view.mount(app);
      screen.render();
    },
    render() {
      screen.render();
    },
    quit() {
      screen.destroy();
      process.exit(0);
    },
    // Lets a caller (the tutorial, for its own confirm-before-finishing
    // step) intercept the global q/C-c quit below instead of it instantly
    // killing the process out from under them. Set to a function that
    // returns true to swallow the keypress and handle it yourself; leave
    // null (the default, restored once done) for the normal one-press quit
    // every other screen in the app already relies on.
    quitGuard: null,
  };

  // A single stray q/C-c used to kill the whole session instantly, real
  // data and all — same "one accidental keypress ends everything" problem
  // the tutorial's own end-of-demo confirm exists to prevent, so it gets
  // the same treatment here: q again confirms, anything else cancels.
  let quitConfirmBox = null;
  const confirmQuit = () => {
    if (quitConfirmBox) return; // already showing — a second q while it's up is the confirm itself, handled below
    quitConfirmBox = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: '50%',
      height: 'shrink',
      tags: true,
      padding: { left: 1, right: 1 },
      border: { type: 'line' },
      style: { border: { fg: C.fox }, fg: C.text },
      label: ` ${t('app.confirmQuitTitle')} `,
    });
    quitConfirmBox.setContent(t('app.confirmQuitHint', C.fox));
    screen.render();
    const onKey = (ch, key) => {
      if (!key || key.name === 'return') return;
      screen.removeListener('keypress', onKey);
      quitConfirmBox.destroy();
      quitConfirmBox = null;
      screen.render();
      if (key.name === 'q') app.quit();
    };
    screen.on('keypress', onKey);
  };

  // Global keys. View-local keys are attached by each view on its own widgets.
  screen.key(['q', 'C-c'], () => {
    if (app.quitGuard && app.quitGuard()) return;
    confirmQuit();
  });

  return app;
}
