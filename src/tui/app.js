import pkg from 'neo-blessed';
const blessed = pkg.default || pkg;
import { C } from './theme.js';

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
  });

  const header = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    tags: true,
    style: { fg: C.text },
  });

  const body = blessed.box({
    parent: screen,
    top: 1,
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
  };

  // Global keys. View-local keys are attached by each view on its own widgets.
  screen.key(['q', 'C-c'], () => app.quit());

  return app;
}
