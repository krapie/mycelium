import { C } from './theme.js';
import { t } from './i18n.js';

// The step-walking engine behind startTutorial() (tutorial.js) — split out
// so that function is setup/wiring only. Every function here takes an
// explicit `ctx` (built by createContext()) instead of closing over
// startTutorial()'s locals, since several of these mutually recurse
// (settleAt <-> pollUntil <-> advanceFrom) and need to share the same
// mutable step-cursor state (ctx.i/ctx.done/ctx.waiting/ctx.scanInjected).
// endTutorial()/injectDemoSessions() are passed in via ctx rather than
// imported directly, to avoid a tutorial.js <-> tutorial-runner.js cycle.
export function createContext({
  app,
  box,
  STEPS,
  mergeFolder,
  sessionCount,
  baseline,
  isModalOpen,
  onDone,
  endTutorial,
  prevDemoMode,
}) {
  return {
    app,
    box,
    STEPS,
    mergeFolder,
    sessionCount,
    baseline,
    isModalOpen,
    onDone,
    endTutorial,
    prevDemoMode,
    i: 0,
    done: false,
    waiting: false, // true while polling for a real modal to open/close
    scanInjected: false,
    keypressHandler: null, // set by startTutorial() once the wrapper closure exists
  };
}

export function render(ctx) {
  const step = ctx.STEPS[ctx.i];
  // "Step N/Total" computed from STEPS' own length/index, not baked into
  // each titleKey — those hold only the subtitle now, so inserting a step
  // never means renumbering every title in both locales.
  ctx.box.setLabel(` ${t('tutorial.stepCounter', ctx.i + 1, ctx.STEPS.length)}${t(step.titleKey)} `);
  // sessionCount/mergeFolder are passed to every step body; only a few
  // (step2/4/5/11, see i18n.js) actually read them.
  const body = ctx.waiting ? t(step.waitingKey) : t(step.bodyKey, C.fox, ctx.sessionCount, ctx.mergeFolder);
  // The last step's "q" hint differs: it hands off to real data instead
  // of abandoning the tour, and the generic exit hint read as contradictory.
  const exitOrFinishHint = ctx.i === ctx.STEPS.length - 1 ? t('tutorial.finishHint') : t('tutorial.exitHint');
  ctx.box.setContent(`${body}\n{${C.faint}-fg}${exitOrFinishHint}{/}`);
  // A real bug: this box mounts once, so any real widget opened later
  // (context viewer, multiSelectList, confirmText) draws on top of it
  // where they overlap, hiding the current step's guidance. setFront()
  // is a pure z-order move on every render, not a focus change.
  ctx.box.setFront();
  ctx.app.render();
}

export function finish(ctx, completed) {
  if (ctx.done) return;
  ctx.done = true;
  ctx.app.tutorialSignal = null;
  ctx.app.screen.removeListener('keypress', ctx.keypressHandler);
  // Deferred, not immediate: program.js fires 'keypress' and the global
  // quit binding's 'key q' synchronously back-to-back for the same press,
  // so clearing the guard here directly would still let that same q
  // trigger the app's own confirm-quit dialog right behind this.
  setImmediate(() => {
    ctx.app.quitGuard = null;
  });
  if (ctx.prevDemoMode === undefined) delete process.env.MYCELIUM_DEMO_MODE;
  else process.env.MYCELIUM_DEMO_MODE = ctx.prevDemoMode;
  ctx.box.destroy();
  ctx.endTutorial();
  ctx.app.render();
  ctx.onDone(!!completed);
}

export function settleAt(ctx, idx) {
  ctx.waiting = false;
  ctx.i = idx;
  render(ctx);
  // pollOnEntry (merge's title-prompt step): blessed.prompt's Enter submit
  // doesn't reliably bubble a matching keypress here, so waitFor:'enter'
  // would never fire. Poll for close directly instead, no key needed.
  if (ctx.STEPS[ctx.i].pollOnEntry) pollUntil(ctx, ctx.STEPS[ctx.i].pollOnEntry === 'open');
}

// Polls until the real action's review modal opens/closes, then settles
// on the next step. Still needed alongside app.tutorialSignal: the signal
// only says the handler started, not that its LLM-backed modal has
// actually appeared yet.
export function pollUntil(ctx, want) {
  const tick = () => {
    if (ctx.done) return;
    if (ctx.isModalOpen() === want) return settleAt(ctx, ctx.i + 1);
    setTimeout(tick, 250);
  };
  tick();
}

// Shared tail for "step j's trigger just fired" — used by both a matched
// keypress (onKeypress below) and a matched app.tutorialSignal, so a step
// reachable from the `.` action menu settles the exact same way regardless
// of which path actually fired it.
export function advanceFrom(ctx, j) {
  ctx.i = j;
  const step = ctx.STEPS[ctx.i];
  if (step.thenWait) {
    ctx.waiting = true;
    render(ctx);
    pollUntil(ctx, step.thenWait === 'open');
  } else {
    settleAt(ctx, ctx.i + 1);
  }
}

// Keys that mean something different almost everywhere (confirming any
// dialog, plain navigation) never count toward skip-ahead — only an exact
// match on the CURRENT step. Every step waiting on one of these is also
// thenWait:'close', so a false-positive match elsewhere used to resolve
// that wait instantly (no real modal ever closed) and cascade the
// narrator forward. `o`/`w`/`n`/Shift+M/Shift+S are safe: each has exactly
// one meaning and thenWait 'open', which only resolves on a real modal.
export const AMBIGUOUS_KEYS = new Set(['enter', 'left', 'right']);

// Shift+M/Shift+S arrive as key.name 'm'/'s' + key.shift:true, not
// blessed's 'S-m' form, so a plain m/s must not satisfy a Shift step.
// Punctuation like '.' has no k.name from readline's parser, only `ch`.
export function matchesWaitFor(step, ch, k) {
  return !!step.waitFor && (k.name === step.waitFor || (!k.name && ch === step.waitFor)) && (!step.shift || k.shift);
}

export function onKeypress(ctx, ch, key) {
  if (ctx.done || !key) return;
  // neo-blessed fires TWO keypress events per physical Enter (synthetic
  // 'enter' then real 'return') — ignore the redundant half so an
  // 'enter' waitFor doesn't double-advance.
  if (key.name === 'return') return;
  // q exits from anywhere, immediately, checked before `waiting` so it
  // works mid-wait too. Only counts as "completed" (cli.js's demo hands
  // off to the real TUI) if pressed on the actual last step.
  if (key.name === 'q') return finish(ctx, ctx.i === ctx.STEPS.length - 1);
  // Real modal open/close waits always resolve on their own; only q above
  // should interrupt one.
  if (ctx.waiting) return;
  // Escape is deliberately not handled here — it used to double as
  // "abort," so closing a real modal with Escape silently ended the tutorial.
  let j = ctx.i;
  if (!matchesWaitFor(ctx.STEPS[j], ch, key)) {
    if (AMBIGUOUS_KEYS.has(key.name)) return;
    while (j < ctx.STEPS.length && !matchesWaitFor(ctx.STEPS[j], ch, key)) j++;
    if (j >= ctx.STEPS.length) return;
  }
  advanceFrom(ctx, j);
}
