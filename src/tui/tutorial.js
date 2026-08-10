import pkg from 'neo-blessed';
const blessed = pkg.default || pkg;
import { C } from './theme.js';
import { t } from './i18n.js';
import { saveRaw, deleteRaw, allRaw } from '../scanner.js';
import { reindex } from '../index-db.js';
import { pruneEmptyFolders } from '../cleanup.js';
import { buildMockSessions } from './tutorial-data.js';
import { __setTestProvider, __clearTestProvider } from '../llm.js';
import { tutorialMockProvider } from './tutorial-mock-llm.js';

/**
 * First-run interactive tutorial (and `mycelium demo`'s engine) — mock
 * sessions dropped into the real store just long enough to walk through
 * Organize (`o`) → Learn (`w`) → Reuse (`c`) → session lineage (Shift+M
 * merge, Shift+S split), using the TUI's own real key handlers (sessions.js
 * is never touched or hooked into: this module just ALSO listens for the
 * same keypresses, purely to advance its own narration, alongside whatever
 * sessions.js's real handlers do with them). `o`/`w`/Shift+S all call
 * llm.js's complete() under the hood — seedMockSessions() swaps that over
 * to tutorialMockProvider() (instant, deterministic, English) for as long
 * as the mock sessions are in the store, so the tutorial stays fast and
 * doesn't depend on a real claude/codex subprocess. See
 * tutorial-mock-llm.js for why.
 */

// `thenWait: 'open'|'close'` marks steps whose key triggers a REAL o/w LLM
// call in sessions.js — the narrator doesn't advance straight off the
// keypress (the LLM call can take anywhere from under a second to 10+
// seconds, and jumping ahead of it left a stale review modal orphaned on
// screen after the tutorial had already moved on / cleaned up). Instead it
// waits for the review modal that real handler opens (multiSelectList for
// `o`, confirmText for `w` — both parented straight to app.screen, same as
// every other picker/viewer in this codebase) to actually appear, then
// waits again for it to close once the matching confirm step's key fires.
// See isModalOpen() below.
const STEPS = [
  { titleKey: 'tutorial.step1Title', bodyKey: 'tutorial.step1Body', waitFor: 'o', thenWait: 'open', waitingKey: 'tutorial.waitingOrganize' },
  { titleKey: 'tutorial.step2Title', bodyKey: 'tutorial.step2Body', waitFor: 'enter', thenWait: 'close', waitingKey: 'tutorial.waitingApply' },
  // waitFor is 'down'/'enter' here, not null — these steps' own text names
  // a specific key (↓ to browse the new folders, Enter to finish), and both
  // also suggest OTHER real keys to go try (v for the calendar, / for
  // search). A bare "any key advances" would treat trying those as "done,
  // move on" and end the tutorial mid-explore instead of letting the human
  // actually poke around like the text invites them to. Was ← at first, but
  // `o` (previous step) is normally pressed from the folders panel already
  // — ← only means anything coming back FROM the sessions panel, so it was
  // a dead key most of the time. ↓ (into the new folder) works either way.
  { titleKey: 'tutorial.step3Title', bodyKey: 'tutorial.step3Body', waitFor: 'down' },
  { titleKey: 'tutorial.step4Title', bodyKey: 'tutorial.step4Body', waitFor: 'w', thenWait: 'open', waitingKey: 'tutorial.waitingKnowledge' },
  { titleKey: 'tutorial.step5Title', bodyKey: 'tutorial.step5Body', waitFor: 'enter', thenWait: 'close', waitingKey: 'tutorial.waitingSave' },
  // Reuse: `c` (view context) rather than `i` (inject AGENTS.md) — both are
  // real, LLM-free, instant reads (reuse.js), but `c` opens exactly one
  // modal (textView) where `i` chains two (textPrompt → confirmText), and
  // isModalOpen()'s DOM-child-count heuristic can't tell "textPrompt closed,
  // confirmText about to open" from "fully closed" if that transition ever
  // landed on a render tick — not worth the risk for what the demo needs to
  // show. waitFor 'q' (not 'escape') to close it: onKeypress's own Escape
  // handling below treats Escape as "abort tutorial" on any non-freeform/
  // final step, which would fire from inside textView too since both listen
  // at the screen level — textView already accepts 'q' as an equivalent
  // close key, so that's the one this step waits for instead.
  { titleKey: 'tutorial.step6Title', bodyKey: 'tutorial.step6Body', waitFor: 'c', thenWait: 'open', waitingKey: 'tutorial.waitingContext' },
  { titleKey: 'tutorial.step7Title', bodyKey: 'tutorial.step7Body', waitFor: 'q', thenWait: 'close', waitingKey: 'tutorial.waitingClose' },
  // Session lineage: merge the two payment sessions (they're genuinely one
  // story — investigate, then fix), then split the result back apart by
  // topic. Both fully reversible (`mycelium unmerge`/`unsplit`), same as the
  // real feature. mergeSessions() itself needs no mocking (no LLM call) —
  // Shift+S's suggestSplitBoundaries() does, same tutorialMockProvider as
  // o/w. Shift+M's real handler no-ops (just a notify(), no modal) unless
  // ≥2 sessions are already Space-selected — that's on the human to have
  // done per this step's own text; nothing here can verify it, same
  // accepted-risk shape as every other step's instructions.
  { titleKey: 'tutorial.step8Title', bodyKey: 'tutorial.step8Body', waitFor: 'm', shift: true, thenWait: 'open', waitingKey: 'tutorial.waitingMerge' },
  { titleKey: 'tutorial.step9Title', bodyKey: 'tutorial.step9Body', pollOnEntry: 'close' },
  { titleKey: 'tutorial.step10Title', bodyKey: 'tutorial.step10Body', waitFor: 's', shift: true, thenWait: 'open', waitingKey: 'tutorial.waitingSplit' },
  { titleKey: 'tutorial.step11Title', bodyKey: 'tutorial.step11Body', waitFor: 'enter', thenWait: 'close', waitingKey: 'tutorial.waitingApply' },
  // freeform: this step's whole point is "go try the real thing" (v for the
  // calendar, / for search) — both of those use Escape themselves for
  // normal back-navigation (calendar/detail → sessions). If the tutorial
  // still treated Escape as "abort tutorial" here, backing out of a real
  // view the step just told you to open would silently kill the tutorial
  // (and, for `mycelium demo`, the whole process) instead of just going
  // back. See onKeypress/render below for how this changes handling.
  { titleKey: 'tutorial.step12Title', bodyKey: 'tutorial.step12Body', waitFor: 'enter', freeform: true },
  // waitFor is 'q', not null/any-key — Enter is what every step up to here
  // used to advance, so leaving the last one on "any key" risked leftover
  // muscle-memory Enter ending the whole tutorial (and, for `mycelium
  // demo`, silently taking the process with it). `q` also doubles as a
  // preview of the real app's own quit key. See onKeypress's `final` branch
  // for the confirm step this triggers before actually finishing.
  { titleKey: 'tutorial.step13Title', bodyKey: 'tutorial.step13Body', waitFor: 'q', final: true },
];

export function seedMockSessions() {
  for (const n of buildMockSessions()) saveRaw(n);
  reindex();
  __setTestProvider(tutorialMockProvider);
}

/** Remove every mock session (and whatever empty folders o/w created along
 * the way) — leaves the real store exactly as it was before the tutorial. */
export function endTutorial() {
  for (const n of allRaw()) {
    if (n.demo) deleteRaw(n.id);
  }
  pruneEmptyFolders();
  reindex();
  __clearTestProvider();
}

/**
 * Mounts the narrator overlay and drives it through STEPS. `app`'s sessions
 * view must already be showing the freshly-seeded mock data (see index.js/
 * cli.js for the seed-then-mount ordering). `onDone` fires once — after the
 * final step, or immediately if the user presses Esc to bail early — with
 * cleanup already done.
 */
export function startTutorial(app, onDone) {
  const box = blessed.box({
    parent: app.screen,
    bottom: 1,
    left: 0,
    right: 0,
    height: 4,
    tags: true,
    padding: { left: 1, right: 1 },
    border: { type: 'line' },
    style: { border: { fg: C.spore }, fg: C.text },
  });

  // Baseline screen-child count right after mounting our own overlay —
  // header/body/statusbar/toast (see app.js's createApp()) plus this box are
  // always present; anything ABOVE that means some picker/viewer opened a
  // modal (they're all `parent: app.screen`, same as this box, per this
  // codebase's convention). Generic across both o's multiSelectList and w's
  // confirmText — no need to know which one is open, just whether one is.
  const baseline = app.screen.children.length;
  const isModalOpen = () => app.screen.children.length > baseline;

  let i = 0;
  let done = false;
  let waiting = false; // true while polling for a real modal to open/close
  let escapeTimer = null; // see the Escape debounce in onKeypress below

  // app.js's screen.key(['q', 'C-c']) instantly process.exit()s from
  // ANYWHERE — that's a separate, always-on global binding, not something
  // this module's own keypress listener can out-race or override on the
  // same 'q' press. Suppress it for the tutorial's whole run so a stray `q`
  // mid-walkthrough (or step7's own confirm exchange below) can't silently
  // kill the process out from under it; restored the moment finish() runs.
  app.quitGuard = () => true;

  const render = () => {
    const step = STEPS[i];
    // t() calls bodyKey's entry with (fg) if it's a function (all step
    // bodies are, to color-highlight the key they're waiting for) and
    // just returns it as-is if it's a plain string — safe either way.
    box.setLabel(` ${t(step.titleKey)} `);
    const body = waiting ? t(step.waitingKey) : t(step.bodyKey, C.fox);
    // freeform and final steps don't own Escape (see onKeypress) — showing
    // "Esc: exit tutorial" on either was actively misleading: on freeform
    // it backs out of whatever real view is open instead of ending the
    // tutorial, and on final it used to let Escape instantly end things
    // unconfirmed, defeating the whole point of requiring q + a confirm.
    const hint = step.freeform || step.final ? '' : `\n{${C.faint}-fg}${t('tutorial.exitHint')}{/}`;
    box.setContent(`${body}${hint}`);
    app.render();
  };

  const finish = () => {
    if (done) return;
    done = true;
    if (escapeTimer) clearTimeout(escapeTimer);
    app.screen.removeListener('keypress', onKeypress);
    // Deferred, not immediate: program.js emits 'keypress' (which is what
    // drives this whole listener) and the global quit binding's 'key q'
    // synchronously back-to-back for the SAME physical press (see
    // program.js's _listenInput). Clearing the guard here directly would
    // still be in time for that same q-press's 'key q' phase to see it
    // gone and instantly quit for real — exactly the confirm-then-
    // immediately-die bug this guard exists to prevent. One tick later,
    // that pair has fully resolved and any FUTURE q is a genuinely new
    // keypress the guard should no longer touch.
    setImmediate(() => {
      app.quitGuard = null;
    });
    box.destroy();
    endTutorial();
    app.render();
    onDone();
  };

  const settleAt = (idx) => {
    waiting = false;
    i = idx;
    render();
    // pollOnEntry (merge's title-prompt step only): blessed.prompt's Enter
    // submit doesn't reliably bubble a matching keypress to this screen-
    // level listener the way blessed.list-based widgets (multiSelectList,
    // confirmText) do — waitFor:'enter' silently never fires, leaving the
    // narrator stuck showing this step's text after the real merge already
    // went through. Sidestep it entirely: as soon as this step is entered
    // (the title prompt is already open from the previous step's
    // thenWait:'open'), start polling for close directly, no keypress match
    // needed — same isModalOpen() poll, just not gated on catching a key.
    if (STEPS[i].pollOnEntry) pollUntil(STEPS[i].pollOnEntry === 'open');
  };

  // The final step doesn't finish() on its own `q` press — it swaps the
  // narrator box into a one-question confirm first (reusing `waiting` to
  // hold the main listener off, same trick the o/w LLM waits use) so a
  // single `q` can't be a stray/accidental tutorial-ending press. `q` again
  // confirms; anything else cancels back to the step's own text.
  const confirmFinish = () => {
    waiting = true;
    box.setLabel(` ${t('tutorial.confirmFinishTitle')} `);
    box.setContent(t('tutorial.confirmFinishHint', C.fox));
    app.render();
    const onConfirmKey = (ch, key) => {
      if (!key || key.name === 'return') return;
      app.screen.removeListener('keypress', onConfirmKey);
      if (key.name === 'q') return finish();
      waiting = false;
      render();
    };
    app.screen.on('keypress', onConfirmKey);
  };

  // Polls (rather than hooking sessions.js's real handlers) until the real
  // o/w action's review modal has opened or closed, then settles on the
  // next step. `want` is what isModalOpen() should read once ready.
  const pollUntil = (want) => {
    const tick = () => {
      if (done) return;
      if (isModalOpen() === want) return settleAt(i + 1);
      setTimeout(tick, 250);
    };
    tick();
  };

  function onKeypress(ch, key) {
    if (done || !key) return;
    // neo-blessed's program.js fires TWO synchronous keypress events for a
    // single physical Enter press: a synthetic one with name forced to
    // 'enter', immediately followed by the original with name 'return'
    // (see program.js ~L393-399). Treating both as separate presses would
    // double-advance a step whose waitFor is 'enter' — ignore the redundant
    // 'return' half of the pair.
    if (key.name === 'return') return;
    const step = STEPS[i];
    // Holding for a real o/w LLM call's review modal to open/close — that
    // wait always ends on its own (buildKnowledgeText/suggestPlacements
    // resolve one way or another), so nothing, including Escape, should be
    // able to abort out from under it. Letting Escape through here used to
    // destroy the narrator box (and wipe the mock sessions via
    // endTutorial()) while the real LLM call kept running in the
    // background — the narrator just vanishing mid-"processing" with no
    // trace of why, since the abort has nothing to do with the real call.
    if (waiting) return;
    // Arrow keys are multi-byte escape sequences (`\x1b[A` etc.) — neo-
    // blessed's keys.js parses whatever arrives in a single 'data' chunk
    // (see emitKeypressEvents in keys.js), with no buffering across reads.
    // If the terminal/tmux/SSH link delivers those bytes split across two
    // reads (common enough in practice), the lone leading ESC byte gets
    // misparsed as a standalone Escape keypress, immediately followed by
    // the real arrow key a moment later. Debounce: hold off reacting to
    // Escape briefly — if another keypress lands right behind it, it was
    // never a real Escape, so drop it instead of already having ended the
    // tutorial (and wiped the mock sessions) out from under a folder-list
    // up/down press.
    if (key.name === 'escape') {
      // freeform: real in-app back-nav here, not "abort". final: q + its
      // own confirm is the only way out of the last step — Escape used to
      // instantly finish it unconfirmed, the exact "accidental keypress
      // ends everything" problem q was introduced to prevent in the first
      // place.
      if (step.freeform || step.final) return;
      if (escapeTimer) clearTimeout(escapeTimer);
      escapeTimer = setTimeout(() => {
        escapeTimer = null;
        finish();
      }, 100);
      return;
    }
    if (escapeTimer) {
      clearTimeout(escapeTimer);
      escapeTimer = null;
    }
    if (step.final) {
      if (key.name === 'q') confirmFinish();
      return;
    }
    // Every non-final step names a specific key now — anything else (e.g.
    // trying the real features a step points at, like v/`/`) is simply not
    // this step's key and is left alone for sessions.js's own handlers.
    // `shift: true` (merge/split steps) requires key.shift too — blessed's
    // raw keypress reports Shift+M as key.name 'm' + key.shift true, NOT
    // 'S-m' (that combo-string form is only how blessed element.key()
    // BINDINGS are declared, e.g. sessions.js's own listBox.key('S-m', ...)
    // — a completely different parser from this raw screen-level listener).
    // Without the shift check, plain `m` (real move) or `s` (real scan)
    // would satisfy waitFor and could falsely advance these steps.
    if (key.name === step.waitFor && (!step.shift || key.shift)) {
      if (step.thenWait) {
        waiting = true;
        render();
        pollUntil(step.thenWait === 'open');
      } else {
        settleAt(i + 1);
      }
    }
  }

  app.screen.on('keypress', onKeypress);
  render();
}
