import pkg from 'neo-blessed';
const blessed = pkg.default || pkg;
import { C } from './theme.js';
import { t, getLocale } from './i18n.js';
import { saveRaw, deleteRaw, allRaw } from '../scanner.js';
import { reindex } from '../index-db.js';
import { pruneEmptyFolders } from '../cleanup.js';
import { buildMockSessions } from './tutorial-data.js';
import { __setTestProvider, __clearTestProvider } from '../llm.js';
import { createTutorialMockProvider } from './tutorial-mock-llm.js';
import { findPersona } from './personas.js';
import { writePendingKnowledgeText } from '../insight.js';

/**
 * First-run interactive tutorial (and `mycelium demo`'s engine) — mock
 * sessions dropped into the real store just long enough to walk through
 * 3-column panel navigation (← →) then Organize (`o`) → Learn (`w`) →
 * Reuse (`c`) → Knowledge review (`k`) → session lineage (Shift+M merge,
 * Shift+S split), using the TUI's own real key handlers (sessions.js is
 * never touched or hooked into: this module just ALSO listens for the same
 * keypresses, purely to advance its own narration, alongside whatever
 * sessions.js's real handlers do with them). `o`/`w`/`k`/Shift+S all call
 * llm.js's complete() under the hood — seedMockSessions() swaps that over
 * to tutorialMockProvider() (fast, deterministic, English — see
 * tutorial-mock-llm.js for why, including why it's deliberately not
 * instant) for as long as the mock sessions are in the store, so the
 * tutorial stays fast without depending on a real claude/codex subprocess.
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
  // What Mycelium actually is, before any mechanics — mirrors README.md's
  // own opening line so the two stay consistent. Deliberately just
  // `tutorial.introTitle`/`introBody`, not renumbered into the stepN
  // sequence below: render() computes the visible "Step N/Total" from this
  // array's length/index now (see render()), so inserting a step here
  // never requires renaming every key after it — only this file's own
  // array order matters.
  //
  // waitFor is 'escape', NOT 'enter' — this is the one step where that
  // matters: at this exact moment (nothing navigated yet, focus still on
  // the initial Folders panel), Enter/Right both trigger sessions.js's own
  // real drillIntoSessions() (foldersBox.key('enter'/'right', ...)),
  // silently drilling into whatever's highlighted and moving focus to the
  // Sessions list — completely derailing step 2's own "→ moves focus"
  // lesson (which now finds focus already moved) and everything
  // choreographed after it. Escape has no binding at all on the initial
  // Folders panel (only detailBox binds it, see sessions.js) — genuinely
  // inert, and since this step is always index 0, forward-only skip-ahead
  // scanning from any later step can never re-match it by accident either.
  // Found by watching the "full lifecycle" e2e test derail at the `w` step
  // several actions later, not by reasoning about this step in isolation.
  { titleKey: 'tutorial.introTitle', bodyKey: 'tutorial.introBody', waitFor: 'escape' },
  // Panel focus: → walks Folders → Sessions → Detail, ← walks back — the
  // very first thing worth knowing before any of the lifecycle steps below,
  // since several of them (browsing into a folder, opening a session) rely
  // on it. No thenWait — this is plain focus movement within the persistent
  // 3-column layout, not a real handler that opens a new modal, so there's
  // nothing for isModalOpen() to poll for.
  { titleKey: 'tutorial.step1Title', bodyKey: 'tutorial.step1Body', waitFor: 'right' },
  { titleKey: 'tutorial.step2Title', bodyKey: 'tutorial.step2Body', waitFor: 'o', thenWait: 'open', waitingKey: 'tutorial.waitingOrganize' },
  { titleKey: 'tutorial.step3Title', bodyKey: 'tutorial.step3Body', waitFor: 'enter', thenWait: 'close', waitingKey: 'tutorial.waitingApply' },
  // waitFor is 'left' here, not 'down' — applying placements (previous
  // step) leaves focus on the Sessions list (nothing in that flow moves it
  // back), so ↓ at this point would just browse session rows, never touch
  // the folder cursor at all, and state.folder would stay whatever it was
  // before step 1's panel-navigation lesson moved focus off Folders in the
  // first place — silently starving every step after this one of a real
  // folder scope (buildKnowledgeText/assembleContext both reduce to "no
  // content" against an unscoped or wrong folder). ← is what actually
  // returns focus to Folders so the human can navigate it for real — found
  // by walking the tutorial live in tmux with the panel-nav step already in
  // place, not obvious from reading the STEPS data in isolation.
  { titleKey: 'tutorial.step4Title', bodyKey: 'tutorial.step4Body', waitFor: 'left' },
  { titleKey: 'tutorial.step5Title', bodyKey: 'tutorial.step5Body', waitFor: 'w', thenWait: 'open', waitingKey: 'tutorial.waitingKnowledge' },
  { titleKey: 'tutorial.step6Title', bodyKey: 'tutorial.step6Body', waitFor: 'enter', thenWait: 'close', waitingKey: 'tutorial.waitingSave' },
  // Reuse: `c` (view context) rather than `i` (inject AGENTS.md) — both are
  // real, LLM-free, instant reads (reuse.js), but `c` opens exactly one
  // modal (textView) where `i` chains two (textPrompt → confirmText), and
  // isModalOpen()'s DOM-child-count heuristic can't tell "textPrompt closed,
  // confirmText about to open" from "fully closed" if that transition ever
  // landed on a render tick — not worth the risk for what the demo needs to
  // show. Step 8 (closing it) is `pollOnEntry`, not a tracked `waitFor` key
  // — textView accepts 'c' (see sessions.js), 'q', and 'escape' as equally
  // valid real close keys, so tracking only one of them left the narrator
  // stuck displaying this step forever if the human used a different one.
  // `pollOnEntry` sidesteps that entirely by not caring which key closed
  // it, just polling for the close itself (same mechanism as the merge
  // step's title prompt below, for the same class of reason) — found by
  // actually walking the tutorial in tmux, not by reasoning about the STEPS
  // data.
  { titleKey: 'tutorial.step7Title', bodyKey: 'tutorial.step7Body', waitFor: 'c', thenWait: 'open', waitingKey: 'tutorial.waitingContext' },
  { titleKey: 'tutorial.step8Title', bodyKey: 'tutorial.step8Body', pollOnEntry: 'close' },
  // Knowledge review (`k`) — deliberately its own unrelated feature from
  // Digest (`d`), not a step in the w/c sequence above; positioned right
  // after it anyway since it's the natural "faster way to do this across
  // every active folder at once" follow-up. Structurally IDENTICAL to
  // steps 2/3 (o's own two steps) on purpose: k either reuses whatever the
  // daemon's independent knowledgeReviewCycle already queued overnight, or
  // computes fresh right then — either way a real multiSelectList opens,
  // so the exact same thenWait:'open'/'close' pair works with zero new
  // mechanism, unlike an earlier draft of this feature that nested the
  // review inside Digest and needed a bespoke poll (see git history/PR
  // discussion if that ever resurfaces — this shape is the one that shipped).
  { titleKey: 'tutorial.step9Title', bodyKey: 'tutorial.step9Body', waitFor: 'k', thenWait: 'open', waitingKey: 'tutorial.waitingKnowledgeReview' },
  { titleKey: 'tutorial.step10Title', bodyKey: 'tutorial.step10Body', waitFor: 'enter', thenWait: 'close', waitingKey: 'tutorial.waitingApply' },
  // Session lineage: merge the two payment sessions (they're genuinely one
  // story — investigate, then fix), then split the result back apart by
  // topic. Both fully reversible (`mycelium unmerge`/`unsplit`), same as the
  // real feature. mergeSessions() itself needs no mocking (no LLM call) —
  // Shift+S's suggestSplitBoundaries() does, same tutorialMockProvider as
  // o/w. Shift+M's real handler no-ops (just a notify(), no modal) unless
  // ≥2 sessions are already Space-selected — that's on the human to have
  // done per this step's own text; nothing here can verify it, same
  // accepted-risk shape as every other step's instructions.
  { titleKey: 'tutorial.step11Title', bodyKey: 'tutorial.step11Body', waitFor: 'm', shift: true, thenWait: 'open', waitingKey: 'tutorial.waitingMerge' },
  { titleKey: 'tutorial.step12Title', bodyKey: 'tutorial.step12Body', pollOnEntry: 'close' },
  { titleKey: 'tutorial.step13Title', bodyKey: 'tutorial.step13Body', waitFor: 's', shift: true, thenWait: 'open', waitingKey: 'tutorial.waitingSplit' },
  { titleKey: 'tutorial.step14Title', bodyKey: 'tutorial.step14Body', waitFor: 'enter', thenWait: 'close', waitingKey: 'tutorial.waitingApply' },
  // This step's whole point is "go try the real thing" (v for the calendar,
  // / for search) — both of those use Escape themselves for normal back-
  // navigation (calendar/detail → sessions), which just works: Escape is
  // never intercepted by the tutorial at all (see onKeypress below), on any
  // step, not just this one.
  { titleKey: 'tutorial.step15Title', bodyKey: 'tutorial.step15Body', waitFor: 'enter' },
  // No waitFor at all — q is handled once, globally, at the top of
  // onKeypress, the same way on every step including this one. This step is
  // just the last thing shown before that q lands.
  { titleKey: 'tutorial.step16Title', bodyKey: 'tutorial.step16Body' },
];

export function seedMockSessions(personaId = 'swe') {
  for (const n of buildMockSessions(personaId)) saveRaw(n);
  reindex();
  __setTestProvider(createTutorialMockProvider(personaId));
  // Pre-stage a knowledge-refresh proposal for the merge-target folder, as
  // if the daemon's independent knowledgeReviewCycle had already computed
  // it overnight — step 9 (`k`) then hits the fast "reuse whatever's
  // queued" path instantly, same experience a real user gets when the
  // daemon beat them to it. Using persona.js's own canned per-folder
  // knowledge text (same content `w`'s mock preview would show for this
  // folder) keeps the demo internally consistent. Written directly (not
  // via a real LLM call) since this is tutorial-side setup, same as
  // buildMockSessions() itself being synthetic rather than a real capture.
  // Cleaned up automatically by endTutorial()'s pruneEmptyFolders() call —
  // once every demo session is removed, that folder has no real sessions
  // left, so the whole directory (including any leftover pending file) is
  // removed with it, same as an unreviewed KNOWLEDGE.md from `w` already is.
  const persona = findPersona(personaId);
  const mergeStoryline = persona.storylines[persona.mergeStorylineIndex];
  writePendingKnowledgeText(mergeStoryline.folder, mergeStoryline.knowledge[getLocale()]);
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

// Exit code `mycelium demo`'s isolated child process (see cli.js) uses to
// signal "the presenter finished the whole tour, hand off to the real TUI"
// back to the parent process — distinct from a plain 0 (quit early / no
// handoff wanted) or a crash. Arbitrary, just needs to not collide with a
// Node-meaningful code (0/1) or a signal-death range (128+).
export const DEMO_HANDOFF_EXIT_CODE = 42;

/**
 * Mounts the narrator overlay and drives it through STEPS. `app`'s sessions
 * view must already be showing the freshly-seeded mock data (see index.js/
 * cli.js for the seed-then-mount ordering). `q` exits the tutorial from
 * anywhere, immediately, no confirm — the only key the tutorial itself
 * reacts to; Escape is left alone entirely (see onKeypress). `onDone
 * (completed)` fires once, with cleanup already done — `completed: true`
 * only if `q` was pressed on the actual last step, `false` otherwise (q
 * anywhere earlier is just "done early").
 */
export function startTutorial(app, onDone, personaId = 'swe') {
  const persona = findPersona(personaId);
  const mergeFolder = persona.storylines[persona.mergeStorylineIndex].folder;
  const sessionCount = persona.storylines.reduce((n, s) => n + s.sessions.length, 0);
  const box = blessed.box({
    parent: app.screen,
    bottom: 1,
    left: 0,
    right: 0,
    // 'shrink', not a fixed height: most step bodies are 1-2 lines and a
    // fixed height sized for those truncated the final step's much longer
    // Context Flywheel recap paragraph (no border/scroll indication either
    // — it just silently cut off mid-sentence). Anchored at `bottom` with no
    // `top`, so a taller step grows the box upward instead of pushing
    // anything below it. render()'s setContent() below recalculates this on
    // every step change, so short steps stay compact again right after.
    height: 'shrink',
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

  // app.js's screen.key(['q']) is a separate, always-on global binding —
  // not something this module's own keypress listener can out-race or
  // override on the same 'q' press, both being independent listeners on
  // the same underlying event. Suppress it for the tutorial's whole run so
  // a stray `q` doesn't ALSO pop the app's own confirm-quit dialog right
  // behind/instead of this module's own direct exit below; restored the
  // moment finish() runs. Deliberately does not (and cannot) suppress C-c
  // — see app.js — Ctrl+C stays a hard exit throughout the tutorial too.
  app.quitGuard = () => true;

  const render = () => {
    const step = STEPS[i];
    // "Step N/Total" is computed here, from this array's own length/index,
    // rather than baked into each titleKey's own string — every prior
    // change to STEPS' length used to mean hand-editing "Step N/16" into
    // every single title across both locales (and renaming stepNTitle keys
    // for everything after the insertion point). i18n titleKey strings now
    // hold only the subtitle (' — Organize', or '' for steps without one).
    // t() calls bodyKey's entry with (fg) if it's a function (all step
    // bodies are, to color-highlight the key they're waiting for) and
    // just returns it as-is if it's a plain string — safe either way.
    box.setLabel(` ${t('tutorial.stepCounter', i + 1, STEPS.length)}${t(step.titleKey)} `);
    // Extra args (sessionCount, mergeFolder) are passed uniformly to every
    // step body — most step bodies are plain (fg) => ... functions that
    // simply ignore the trailing args; only step2/4/5/11 (see i18n.js)
    // actually read them, to interpolate the active persona's session count
    // / merge-target folder instead of a hardcoded `backend/payments`.
    const body = waiting ? t(step.waitingKey) : t(step.bodyKey, C.fox, sessionCount, mergeFolder);
    box.setContent(`${body}\n{${C.faint}-fg}${t('tutorial.exitHint')}{/}`);
    app.render();
  };

  const finish = (completed) => {
    if (done) return;
    done = true;
    app.screen.removeListener('keypress', onKeypress);
    // Deferred, not immediate: program.js emits 'keypress' (which is what
    // drives this whole listener) and the global quit binding's 'key q'
    // synchronously back-to-back for the SAME physical press (see
    // program.js's _listenInput). Clearing the guard here directly would
    // still be in time for that same q-press's 'key q' phase to see it
    // gone and fire its own confirm-quit dialog right behind this — exactly
    // the double-handling this guard exists to prevent. One tick later,
    // that pair has fully resolved and any FUTURE q is a genuinely new
    // keypress the guard should no longer touch.
    setImmediate(() => {
      app.quitGuard = null;
    });
    box.destroy();
    endTutorial();
    app.render();
    onDone(!!completed);
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

  // Whether `key` is the exact keypress `step` is narrating/waiting for —
  // same `shift`-flag reasoning as the inline comment below: Shift+M/Shift+S
  // arrive as key.name 'm'/'s' + key.shift:true, not blessed's 'S-m' combo
  // form, so a plain m/s must not satisfy a step whose waitFor needs Shift.
  const matchesWaitFor = (step, k) => !!step.waitFor && k.name === step.waitFor && (!step.shift || k.shift);

  // Keys that mean something different almost everywhere in the app —
  // confirming ANY dialog, plain panel navigation — never count toward the
  // skip-ahead scan below, only an exact match on the CURRENT step. Every
  // step whose waitFor is one of these also happens to be a thenWait:'close'
  // step (see STEPS), which is what made the very first version of
  // skip-ahead actively dangerous: isModalOpen() is already false whenever
  // no modal happens to be open, so a false-positive 'enter' match on a
  // step several ahead resolved its thenWait:'close' wait INSTANTLY (no
  // real modal ever had to close), landing on the step after THAT — one
  // stray Enter (e.g. drilling into a session's detail view, dismissing an
  // unrelated toast) could cascade the narrator several steps forward with
  // no corresponding real action at all. `o`/`w`/`c`/Shift+M/Shift+S don't
  // have this problem: each has exactly one real meaning in this app, so a
  // match always corresponds to that specific real handler actually having
  // run, and their thenWait is always 'open' — which only resolves once a
  // modal genuinely appears, never trivially.
  const AMBIGUOUS_KEYS = new Set(['enter', 'left', 'right']);

  function onKeypress(ch, key) {
    if (done || !key) return;
    // neo-blessed's program.js fires TWO synchronous keypress events for a
    // single physical Enter press: a synthetic one with name forced to
    // 'enter', immediately followed by the original with name 'return'
    // (see program.js ~L393-399). Treating both as separate presses would
    // double-advance a step whose waitFor is 'enter' — ignore the redundant
    // 'return' half of the pair.
    if (key.name === 'return') return;
    // q exits the tutorial from anywhere, immediately, no confirm — checked
    // before even the `waiting` gate below, so it works reliably even mid-
    // wait (a real LLM call in flight, a modal-close poll, whatever). Only
    // counts as a full "completed" run — which cli.js's demo command reads
    // as "hand off to the real TUI" (DEMO_HANDOFF_EXIT_CODE) — if pressed
    // on the actual last step; q anywhere earlier is "done early, no
    // handoff", since someone who didn't reach the end didn't ask to see
    // real (possibly sensitive) data next.
    if (key.name === 'q') return finish(i === STEPS.length - 1);
    // Holding for a real o/w LLM call's review modal to open/close — that
    // wait always ends on its own (buildKnowledgeText/suggestPlacements
    // resolve one way or another), so nothing but q above should be able to
    // interrupt it.
    if (waiting) return;
    // Escape is deliberately not handled here at all, on any step. It used
    // to double as "abort the tutorial", which meant closing a real modal
    // with Escape (its own normal close key, same as q on most of them)
    // silently ended the whole tutorial as a side effect of a completely
    // unrelated widget's own close behavior. Left alone, Escape just does
    // whatever the real widget/view underneath does with it — closing a
    // modal, stepping back a panel (calendar/detail → sessions) — exactly
    // like it would outside the tutorial. q above is now the only key the
    // tutorial itself reacts to.
    //
    // Every step names a specific key; anything else (e.g. trying the real
    // features a step points at, like v/`/`) is simply not this step's key
    // and is left alone for sessions.js's own handlers.
    //
    // This listener never gates sessions.js's own bindings — it only
    // narrates alongside them — so a human who jumps ahead (e.g. pressing
    // `o` while still on step 1's pure panel-navigation lesson) still
    // triggers the real action; only the narrator was previously left
    // behind, stuck showing the skipped step forever since its own
    // waitFor never matched. An exact match on the CURRENT step always
    // wins; failing that, and only for a non-ambiguous key (see
    // AMBIGUOUS_KEYS above), scan forward for the first LATER step this
    // keypress actually satisfies and jump straight there — steps in
    // between (already-passed instructions) are silently skipped, same as
    // if the human had pressed each of their keys in order. Anything else
    // — no match at all, or an ambiguous key that only matches a step
    // other than the current one — falls through untouched.
    let j = i;
    if (!matchesWaitFor(STEPS[j], key)) {
      if (AMBIGUOUS_KEYS.has(key.name)) return;
      while (j < STEPS.length && !matchesWaitFor(STEPS[j], key)) j++;
      if (j >= STEPS.length) return;
    }
    i = j;
    const step = STEPS[i];
    if (step.thenWait) {
      waiting = true;
      render();
      pollUntil(step.thenWait === 'open');
    } else {
      settleAt(i + 1);
    }
  }

  app.screen.on('keypress', onKeypress);
  render();
}
