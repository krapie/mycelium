import pkg from 'neo-blessed';
const blessed = pkg.default || pkg;
import { C } from './theme.js';
import { t, getLocale, setLocale } from './i18n.js';
import { killInFlight } from '../llm.js';
import { VERSION } from '../version.js';

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
// input/output let a caller substitute fake streams — test/tui-helpers.js's
// createTestApp() uses this to drive the real app (real handlers, real
// data layer) against a PassThrough pair instead of a real TTY, with no
// other change to this function. Every production call site calls
// createApp() with no args, so this defaults to blessed's own normal
// process.stdin/stdout behavior.
export function createApp({ input, output } = {}) {
  const screen = blessed.screen({
    smartCSR: true,
    title: 'Mycelium',
    fullUnicode: true,
    autoPadding: true,
    input,
    output,
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

  // See startSpinner()'s own comment (below) for why this exists — counts
  // active startSpinner()/startProgressBar() calls, since both reuse a
  // permanent screen child that tutorial.js's isModalOpen() can't see.
  let busyWidgets = 0;
  // Shared by both stop() methods: a spinner and a progress bar increment
  // the same counter, so whichever stop() is last out is the one that
  // needs to hide `toast`, and that isn't always the spinner's own stop().
  const hideToastIfIdle = () => {
    if (busyWidgets <= 0) {
      toast.hide();
      screen.render();
    }
  };

  // Separate from `toast`: a real filling bar for the two smart-organize
  // phases that already know a true total (see sessions.js's
  // runSmartOrganize()), unlike the spinner. Kept as its own persistent
  // widget for the same flicker/re-arm reasons as `toast` — see startSpinner().
  const progressBox = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: '50%',
    height: 4,
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: C.fox }, fg: C.text },
    hidden: true,
  });
  const progressBar = blessed.progressbar({
    parent: progressBox,
    top: 1,
    left: 0,
    right: 0,
    height: 1,
    orientation: 'horizontal',
    pch: ' ',
    style: { bar: { bg: C.fox } },
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
      // {|} is the same right-align fill token setHeader() uses above — puts
      // the version in the bottom-right corner of every screen instead of
      // only inside the ? help modal, without every setStatus() caller
      // needing to pass it through themselves.
      statusbar.setContent(` ${hints}{|}{${C.dim}-fg}v${VERSION}{/}`);
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
    // Animated wait indicator — re-displays the toast every 120ms with a
    // cycling braille frame; update(msg) changes the label without restarting.
    // Real bug: blessed.message's own hide() timeout is never cleared on a
    // later show()/display(), so a stale timer could hide an active spinner
    // mid-call — fixed by having tick() defensively call show() every frame.
    startSpinner(msg) {
      // Counted, not just toggled — `toast` is a permanent screen child, so
      // tutorial.js's screen.children.length-based isModalOpen() can't see
      // it. Real bug this closes: merge/split's second auto-summarize
      // spinner was invisible to the narrator, which advanced the instant
      // the (separate, counted) review modal closed.
      busyWidgets++;
      const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
      let i = 0;
      let label = msg;
      const frame = () => `${frames[(i = (i + 1) % frames.length)]} ${label}`;
      // Per-frame ticks use setContent(text, true) (noClear) instead of
      // toast.display() — display() clears the region before every redraw,
      // which flickers once sustained over several seconds. Safe to skip
      // the clear since only the leading glyph changes frame to frame.
      const tick = () => {
        // show() every frame — see this method's header comment for why.
        toast.show();
        toast.setContent(frame(), true);
        screen.render();
      };
      tick();
      const timer = setInterval(tick, 120);
      return {
        // Deliberately without noClear, unlike tick() — the label itself
        // changed (e.g. "3/6" → "4/6"), so a shorter replacement needs the
        // region actually cleared.
        update(newMsg) {
          label = newMsg;
          toast.show();
          toast.setContent(frame());
          screen.render();
        },
        stop() {
          clearInterval(timer);
          busyWidgets--;
          // Only hide the shared toast once NOTHING else is busy — real bug:
          // this used to hide unconditionally, so two overlapping spinners
          // (e.g. an impatient re-trigger before the first stopped) meant
          // whichever finished first hid the toast for both, reading as
          // "closed early" while the other kept genuinely running.
          hideToastIfIdle();
        },
      };
    },
    // Real progress, for the two runSmartOrganize() phases that already
    // track a true total — startSpinner()'s fake motion is for when there
    // isn't one. `label` is a static prefix; update() appends "(current/total)".
    startProgressBar(label) {
      // Same permanent-widget blind spot as startSpinner() above (see its
      // comment) — counted the same way.
      busyWidgets++;
      progressBar.setProgress(0);
      progressBox.setContent(`{bold}${label}{/}`);
      progressBox.show();
      screen.render();
      return {
        update(current, total) {
          const pct = total > 0 ? Math.min(100, Math.floor((current / total) * 100)) : 0;
          progressBox.setContent(`{bold}${label}{/} (${current}/${total})`);
          progressBar.setProgress(pct);
          screen.render();
        },
        stop() {
          progressBox.hide();
          screen.render();
          busyWidgets--;
          // See hideToastIfIdle()'s own comment — a spinner could have
          // started (and left its own stop() unable to hide the toast yet)
          // after this progress bar did; if THIS is the call that brings
          // the shared count to 0, the toast needs hiding too, not just
          // this method's own progressBox.
          hideToastIfIdle();
        },
      };
    },
    // True while any startSpinner()/startProgressBar() is active — see
    // startSpinner()'s own comment for why tutorial.js's isModalOpen()
    // needs this instead of relying on screen.children.length alone.
    isBusy() {
      return busyWidgets > 0;
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
    // code lets a caller signal something to a parent process via exit code
    // (see tutorial.js's DEMO_HANDOFF_EXIT_CODE) — every other caller just
    // calls quit() with no args, which keeps the normal 0.
    quit(code = 0) {
      // Best-effort, not awaited — see llm.js's killInFlight()/inFlight for
      // why this exists (orphaned claude/codex subprocesses surviving past
      // mycelium's own exit, real bug found in production). Every quit
      // path funnels through here (the tutorial's own DEMO_HANDOFF_EXIT_CODE
      // quit included), so this is the one place that needs it.
      killInFlight();
      screen.destroy();
      process.exit(code);
    },
    // Lets a caller (the tutorial) intercept the global q quit instead of
    // it also firing right behind. Return true to swallow the keypress;
    // leave null (default) for the normal confirm-quit. Never gates C-c.
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

  // l: switch UI language (en <-> ko, so a toggle). No live re-render:
  // sessionsView() doesn't clean up its own screen.key() bindings on
  // unmount, so re-mounting in place left stale closures over detached
  // boxes — persist and restart instead, same as `mycelium lang <en|ko>`.
  let langConfirmBox = null;
  const confirmLanguageSwitch = () => {
    if (langConfirmBox) return; // already showing — a second l while it's up is the confirm itself, handled below
    const next = getLocale() === 'ko' ? 'en' : 'ko';
    const label = next === 'ko' ? '한국어' : 'English';
    langConfirmBox = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: '50%',
      height: 'shrink',
      tags: true,
      padding: { left: 1, right: 1 },
      border: { type: 'line' },
      style: { border: { fg: C.fox }, fg: C.text },
      label: ` ${t('app.confirmLanguageTitle')} `,
    });
    langConfirmBox.setContent(t('app.confirmLanguageHint', C.fox, label));
    screen.render();
    const onKey = (ch, key) => {
      if (!key || key.name === 'return') return;
      screen.removeListener('keypress', onKey);
      langConfirmBox.destroy();
      langConfirmBox = null;
      screen.render();
      if (key.name === 'l') {
        setLocale(next);
        app.quit();
      }
    };
    screen.on('keypress', onKey);
  };

  // Global keys. View-local keys are attached by each view on its own widgets.
  screen.key(['q'], () => {
    if (app.quitGuard && app.quitGuard()) return;
    confirmQuit();
  });
  // Same quitGuard reuse as q above — quitGuard() is unconditionally `() =>
  // true` for a tutorial's entire duration (see tutorial.js), not just at
  // the moment q is pressed, so gating l on it too blocks a language switch
  // for as long as a tutorial/demo is actively running. Not worth the
  // complexity of re-seeding mock content mid-run in a new language —
  // demo language is a deliberate, locked-in choice made once at the
  // persona-picker step (index.js), same as the persona itself.
  screen.key(['l'], () => {
    if (app.quitGuard && app.quitGuard()) return;
    confirmLanguageSwitch();
  });
  // C-c: unconditional hard exit, never gated by quitGuard. Skips the
  // tutorial's own endTutorial() cleanup if one is active against the real
  // store — a few leftover demo:true sessions, recoverable via `mycelium
  // cleanup`, not data loss; not worth complicating Ctrl+C's semantics for.
  screen.key(['C-c'], () => app.quit());

  return app;
}
