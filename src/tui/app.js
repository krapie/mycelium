import pkg from 'neo-blessed';
const blessed = pkg.default || pkg;
import { C } from './theme.js';
import { t, getLocale, setLocale } from './i18n.js';
import { killInFlight } from '../llm.js';

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
  // permanent screen child (show()/hide() only toggle visibility) that
  // tutorial.js's screen.children.length-based isModalOpen() can't see.
  let busyWidgets = 0;
  // Shared by both stop() methods below — startProgressBar()'s own stop()
  // decrementing busyWidgets to 0 needs to be able to hide `toast` too, not
  // just its own progressBox: a spinner and a progress bar both increment
  // the same counter, so whichever of the two stop()s happens to be the
  // LAST one out is the one that actually needs to hide the toast, and
  // that isn't always the spinner's own stop(). Only startSpinner() ever
  // shows the toast, but either stop() can be what finally makes it safe
  // to hide.
  const hideToastIfIdle = () => {
    if (busyWidgets <= 0) {
      toast.hide();
      screen.render();
    }
  };

  // Separate from `toast`: a real filling bar for the two smart-organize
  // phases (summarize, classify) that already know a true total up front
  // (see sessions.js's runSmartOrganize()) — unlike the spinner, which
  // exists precisely because most LLM-bound calls elsewhere DON'T know a
  // total. Kept as its own persistent widget (not built/destroyed per
  // call) for the same flicker/re-arm reasons `toast` is — see
  // startSpinner()'s comments just below.
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
    // Animated wait indicator for LLM-bound calls — re-displays the toast
    // every 120ms with a cycling braille spinner frame (same family npm/
    // yarn/ora use; the screen is created with fullUnicode: true so this is
    // safe to render). update(msg) lets a caller with real progress (a
    // batch count, a completed-item count) change the label without
    // restarting the spinner itself — see sessions.js's summarize/smart-
    // organize progress toasts.
    //
    // A real, confirmed-in-production bug lived here: blessed.message's own
    // `display(text, seconds, cb)` (used by notify() elsewhere, and by an
    // earlier version of this method's own "rearm" logic) schedules an
    // internal setTimeout that calls `self.hide()` unconditionally once
    // `seconds` elapses — and neo-blessed's implementation (message.js)
    // never clears that timeout on a LATER show()/display()/hide() call.
    // Every `display()` call creates its own independent hide-timer that
    // WILL fire at its own scheduled time no matter what happens afterward.
    // A previous version of this method tried to "re-arm" against this by
    // calling `toast.display(frame(), 60, cb)` every 20s — that doesn't
    // cancel the earlier timer, it just piles up ANOTHER one; the ORIGINAL
    // deadline (from THIS spinner's own first tick, or — worse — from any
    // earlier, wholly unrelated notify() call still pending when THIS
    // spinner starts) still fires and calls hide() out from under an
    // actively-running spinner. Confirmed via VHS against a REAL (non-
    // mocked) merge: the "Summarizing…" toast was invisible for the entire
    // ~15s duration of a real claude call, with nothing on screen until the
    // final result toast — exactly the "gone after a few seconds but
    // actually still running" symptom reported. Fixed below by having
    // tick() defensively call show() on every 120ms frame, not just once at
    // start — decisively overriding any stale hide() from ANY source with
    // at most a 120ms flicker, without needing to know where that hide()
    // came from. update() now uses the same safe setContent()+render()
    // path as tick() (previously used display(), which had the identical
    // stale-timer problem) instead of blessed's auto-hide machinery.
    startSpinner(msg) {
      // Counted, not just toggled — busyWidgets++/-- below is what
      // isBusy() reports, since `toast` itself is a permanent screen child
      // created once here in createApp() (show()/hide() just toggle
      // visibility, never actually add/remove it from screen.children).
      // tutorial.js's own isModalOpen() heuristic (screen.children.length
      // > a baseline captured after this app already exists) is blind to
      // that — a real bug found in production: sessions.js's merge/split
      // handlers start a SECOND spinner (auto-summarizing the result) right
      // after their own review modal (a real, counted widget) closes; the
      // narrator's thenWait:'close' step saw the review modal's close and
      // advanced immediately, landing on the next step's caption while this
      // second spinner was still visibly running underneath it — two things
      // on screen the narrator never accounted for both being true at once.
      // isBusy() closes that blind spot without changing `toast`'s own
      // architecture (it's reused for plain notify() toasts too, elsewhere).
      busyWidgets++;
      const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
      let i = 0;
      let label = msg;
      const frame = () => `${frames[(i = (i + 1) % frames.length)]} ${label}`;
      // Per-frame ticks use setContent(text, true) (noClear), not
      // toast.display() — display() calls setContent() without noClear,
      // which clears the toast's screen region before every redraw
      // (element.js's clearPos()). Doing that every 120ms is invisible for
      // a call that resolves in under a second, but visibly flickers (a
      // real clear-then-redraw flash) once sustained over several real
      // seconds — only became noticeable after mycelium demo's mock LLM
      // delay grew from near-instant to a deliberate multi-second wait
      // (tutorial-mock-llm.js). Safe to skip the clear here since the
      // label text is identical frame to frame — only the leading
      // single-width braille glyph changes, so there's nothing stale left
      // over to expose.
      const tick = () => {
        // show() every frame, not just once at start — see this method's
        // own header comment for why: decisively overrides any stale
        // hide() (blessed's own uncleared auto-hide timeout, from this
        // spinner or an unrelated earlier notify()) within 120ms, without
        // needing to know where that hide() call came from.
        toast.show();
        toast.setContent(frame(), true);
        screen.render();
      };
      tick();
      const timer = setInterval(tick, 120);
      return {
        // Deliberately WITHOUT noClear, unlike tick() above — update() means
        // the label itself changed (e.g. sessions.js's progress toasts,
        // "3/6" → "4/6"), so the region genuinely needs clearing in case the
        // new text is shorter than what it's replacing (setContent()'s own
        // noClear param controls exactly this — element.js's clearPos()).
        // Uses setContent() directly rather than display() (which the
        // original version of this method used) for the same stale-timer
        // reason tick() now calls show() defensively — see this method's
        // header comment.
        update(newMsg) {
          label = newMsg;
          toast.show();
          toast.setContent(frame());
          screen.render();
        },
        stop() {
          clearInterval(timer);
          busyWidgets--;
          // Only actually hide the shared toast once NOTHING else is still
          // busy — a real bug found in production: `toast` is one widget
          // shared by every startSpinner() call (merge/split's own summarize
          // spinner, any other in-flight LLM-bound action), and this used to
          // call toast.hide() unconditionally. Two overlapping spinners —
          // e.g. an impatient re-trigger of the same action before its own
          // first spinner had stopped (merge, before it had a guard against
          // this — see sessions.js) — meant whichever one finished FIRST hid
          // the toast for BOTH, reading as "the modal closed early" while
          // the other operation kept genuinely running, landing its real
          // result later with nothing on screen to show for it in between.
          // (The daemon's own periodic scan/tag/organize cycles — see
          // daemon/cycles.js — never touch this widget at all: those run
          // headless, with no spinner of their own, so they can't collide
          // with a user's spinner here regardless.) Leaves whatever label is
          // currently showing alone if something else is still in flight;
          // that other spinner's own tick() (still running on its own
          // interval) corrects the label on its next frame if it changed.
          // A startProgressBar() call sharing busyWidgets with this spinner
          // (not exercised by any real UI flow today — see
          // hideToastIfIdle()'s own comment) is exactly why this delegates
          // to the shared helper instead of checking/hiding inline: whoever
          // decrements busyWidgets to 0 needs to hide the toast, and that
          // isn't always this method.
          hideToastIfIdle();
        },
      };
    },
    // Real progress, for the two runSmartOrganize() phases that already
    // track a true total (summarize count, placement chunk count) rather
    // than an open-ended LLM wait — startSpinner()'s animated-but-fake
    // motion is the right call when there's no total to show; this is for
    // when there is one. `label` is a static prefix (no counts baked in —
    // update() appends "(current/total)" itself so every caller formats
    // the same way); progressBar is a child of progressBox, so hiding the
    // box on stop() takes the bar with it.
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
    // Lets a caller (the tutorial, which handles its own q directly — see
    // tutorial.js) intercept the global q quit below instead of it also
    // firing right behind/instead of that. Set to a function that returns
    // true to swallow the keypress and handle it yourself; leave null (the
    // default, restored once done) for the normal one-press-then-confirm
    // quit every other screen in the app already relies on. Deliberately
    // does NOT gate C-c at all (see the key bindings below) — Ctrl+C is
    // meant to work as a hard, unconditional exit no matter what's on
    // screen, guard or not.
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

  // l: switch UI language (en <-> ko — only two exist, so a toggle rather
  // than another picker menu). No live re-render: sessionsView() doesn't
  // clean up its own screen.key() bindings on unmount (a real bug this
  // codebase already hit once — re-mounting it in place left stale closures
  // capturing already-detached boxes), so the safe way to apply a new
  // locale to everything already on screen is to persist it and restart,
  // same as the existing `mycelium lang <en|ko>` CLI command already
  // requires. setLocale() itself does take effect immediately for any t()
  // call made AFTER this point, which is what already-updates-live things
  // like the confirm box below rely on, and what the whole demo/first-run
  // language-picker flow (index.js) leans on to avoid needing this
  // restart at all — this key is specifically for an ALREADY-RUNNING
  // real session someone wants to switch on the fly.
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
  // C-c: unconditional hard exit, on top of q — never gated by quitGuard,
  // never asks first. The standard "just kill it" expectation for Ctrl+C
  // specifically, unlike q (which is allowed to confirm, and which a
  // caller like the tutorial can intercept to handle its own way).
  // Deliberate trade-off: this skips the tutorial's own endTutorial()
  // cleanup if one is active in the real ~/.mycelium store (the first-run
  // path, not `mycelium demo`'s already-isolated store) — a few leftover
  // demo:true sessions, not data loss, recoverable via `mycelium cleanup`.
  // Not worth adding cleanup-ordering complexity to what Ctrl+C users
  // expect to be an immediate, no-questions-asked exit.
  screen.key(['C-c'], () => app.quit());

  return app;
}
