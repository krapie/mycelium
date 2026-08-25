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
 * First-run interactive tutorial (and `mycelium demo`'s engine). The 5
 * action handlers reachable from the `.` palette also call
 * `app.tutorialSignal?.(name)` past their own guards, since selecting a
 * palette item confirms via Enter — indistinguishable from any other
 * dialog by keypress alone.
 *
 * Mock sessions are NOT written up front: the real flow mounts the
 * Sessions view empty, and injectDemoSessions() fires from
 * app.tutorialSignal('scan'), timed to the Scan step's own keypress, so
 * "press s to capture them" is literally true. seedMockSessions() does
 * both eagerly for callers (mostly tests) that don't need that reveal.
 */

// `thenWait: 'open'|'close'` marks steps whose key triggers a real LLM call
// (o/w) — the narrator waits for that handler's review modal to actually
// appear/close instead of advancing straight off the keypress, which used
// to leave a stale modal orphaned on screen. See isModalOpen() below.
const STEPS = [
  // What Mycelium is, mirroring README.md's opening line, merged with the
  // panel-navigation lesson (→/← through Folders/Sessions/Detail). Always
  // index 0, so skip-ahead scanning from a later step can never re-match it.
  // waitFor 'enter' is also sessions.js's real foldersBox 'enter' binding —
  // pressing it both advances the narrator and drills into Sessions.
  { titleKey: 'tutorial.introTitle', bodyKey: 'tutorial.introBody', waitFor: 'enter' },
  // Introduce `.` up front so every later step's key reads as "a palette
  // entry you already saw." Split into open/close steps because
  // isModalOpen() only tracks the open/close transition, not "acknowledged."
  { titleKey: 'tutorial.stepPaletteTitle', bodyKey: 'tutorial.stepPaletteBody', waitFor: '.', thenWait: 'open', waitingKey: 'tutorial.waitingPalette' },
  { titleKey: 'tutorial.stepPaletteAckTitle', bodyKey: 'tutorial.stepPaletteAckBody', waitFor: 'escape', thenWait: 'close', waitingKey: 'tutorial.waitingPaletteClose' },
  // Capture, taught where the palette showed it first — signalFor only, no
  // waitFor/thenWait, since doScan() has no review modal to poll. Also where
  // injectDemoSessions() actually runs (see app.tutorialSignal below) — the
  // Sessions view is empty until this exact keypress.
  { titleKey: 'tutorial.stepScanTitle', bodyKey: 'tutorial.stepScanBody', signalFor: 'scan' },
  { titleKey: 'tutorial.step2Title', bodyKey: 'tutorial.step2Body', waitFor: 'o', signalFor: 'organize', thenWait: 'open', waitingKey: 'tutorial.waitingOrganize' },
  { titleKey: 'tutorial.step3Title', bodyKey: 'tutorial.step3Body', waitFor: 'enter', thenWait: 'close', waitingKey: 'tutorial.waitingApply' },
  // waitFor 'left', not 'down': applying placements leaves focus on the
  // Sessions list, so ↓ would just browse rows without ever moving the
  // folder cursor, starving later steps of a real state.folder scope. ←
  // is what actually returns focus to Folders.
  { titleKey: 'tutorial.step4Title', bodyKey: 'tutorial.step4Body', waitFor: 'left' },
  { titleKey: 'tutorial.step5Title', bodyKey: 'tutorial.step5Body', waitFor: 'w', signalFor: 'knowledge', thenWait: 'open', waitingKey: 'tutorial.waitingKnowledge' },
  { titleKey: 'tutorial.step6Title', bodyKey: 'tutorial.step6Body', waitFor: 'enter', thenWait: 'close', waitingKey: 'tutorial.waitingSave' },
  // Reuse: `c` rather than `i` — both are real, instant reads, but `c` opens
  // one modal where `i` chains two, risking a false "fully closed" read
  // mid-transition. Step 8 uses `pollOnEntry`, not a tracked waitFor key,
  // since textView accepts 'c'/'q'/'escape' as equally valid closes.
  { titleKey: 'tutorial.step7Title', bodyKey: 'tutorial.step7Body', waitFor: 'c', thenWait: 'open', waitingKey: 'tutorial.waitingContext' },
  { titleKey: 'tutorial.step8Title', bodyKey: 'tutorial.step8Body', pollOnEntry: 'close' },
  // Reuse in practice: two palette openings, one per key. n and h look
  // similar in the palette but differ in what they carry — n launches a
  // NEW task with only the folder's KNOWLEDGE, h continues THIS session
  // with its full transcript, both on a possibly different agent. Show
  // them in separate steps so that distinction sinks in. Neither key is
  // actually pressed inside the tutorial — both spawn a real
  // claude/codex/kiro subprocess (foreground()), which the demo
  // deliberately avoids; open the palette, look, Esc, move on.
  { titleKey: 'tutorial.stepReuseNTitle', bodyKey: 'tutorial.stepReuseNBody', waitFor: '.', thenWait: 'open', waitingKey: 'tutorial.waitingReuseN' },
  { titleKey: 'tutorial.stepReuseNAckTitle', bodyKey: 'tutorial.stepReuseNAckBody', waitFor: 'escape', thenWait: 'close', waitingKey: 'tutorial.waitingReuseNClose' },
  { titleKey: 'tutorial.stepReuseHTitle', bodyKey: 'tutorial.stepReuseHBody', waitFor: '.', thenWait: 'open', waitingKey: 'tutorial.waitingReuseH' },
  { titleKey: 'tutorial.stepReuseHAckTitle', bodyKey: 'tutorial.stepReuseHAckBody', waitFor: 'escape', thenWait: 'close', waitingKey: 'tutorial.waitingReuseHClose' },
  // Knowledge review (`k`) — deliberately unrelated to Digest (`d`),
  // positioned here as the natural "faster, across every folder" follow-up.
  // Structurally identical to steps 2/3: a real multiSelectList opens either
  // way, so the same thenWait:'open'/'close' pair works with no new mechanism.
  { titleKey: 'tutorial.step9Title', bodyKey: 'tutorial.step9Body', waitFor: 'k', thenWait: 'open', waitingKey: 'tutorial.waitingKnowledgeReview' },
  { titleKey: 'tutorial.step10Title', bodyKey: 'tutorial.step10Body', waitFor: 'enter', thenWait: 'close', waitingKey: 'tutorial.waitingApply' },
  // Session lineage: merge two related sessions, then split the result back
  // apart by topic — both reversible, same as the real feature.
  // mergeSessions() needs no mocking; Shift+S's suggestSplitBoundaries()
  // does. Shift+M no-ops silently unless ≥2 sessions are already selected —
  // nothing here can verify that happened, same as any other step's text.
  { titleKey: 'tutorial.step11Title', bodyKey: 'tutorial.step11Body', waitFor: 'm', shift: true, signalFor: 'merge', thenWait: 'open', waitingKey: 'tutorial.waitingMerge' },
  { titleKey: 'tutorial.step12Title', bodyKey: 'tutorial.step12Body', pollOnEntry: 'close' },
  { titleKey: 'tutorial.step13Title', bodyKey: 'tutorial.step13Body', waitFor: 's', shift: true, signalFor: 'split', thenWait: 'open', waitingKey: 'tutorial.waitingSplit' },
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

/** Writes the persona's mock sessions to the store — the one visible part
 * of setup, split out so the tutorial flow can defer it to the Scan step's
 * signal instead of showing it before the tour starts. NOT idempotent —
 * buildMockSessions() stamps a fresh id per call, so callers that might run
 * after a caller-side seedMockSessions() must check for existing demo
 * sessions first. */
export function injectDemoSessions(personaId = 'swe') {
  for (const n of buildMockSessions(personaId)) saveRaw(n);
  reindex();
}

/** LLM mock + knowledge pre-stage only — no session rows written, so the
 * Sessions view stays genuinely empty until injectDemoSessions() runs. */
export function prepareTutorialProvider(personaId = 'swe') {
  __setTestProvider(createTutorialMockProvider(personaId));
  // Pre-stage a knowledge-refresh proposal for the merge-target folder, as if
  // the daemon's knowledgeReviewCycle already computed it overnight — step 9
  // then hits the fast "reuse whatever's queued" path. Cleaned up
  // automatically by endTutorial()'s pruneEmptyFolders() once the folder has
  // no real sessions left.
  const persona = findPersona(personaId);
  const mergeStoryline = persona.storylines[persona.mergeStorylineIndex];
  writePendingKnowledgeText(mergeStoryline.folder, mergeStoryline.knowledge[getLocale()]);
}

/** Convenience for callers that want the whole demo store ready immediately
 * (mostly tests not specifically exercising the Scan step's own reveal) —
 * everything prepareTutorialProvider()/injectDemoSessions() do, eagerly,
 * back-to-back. The real tutorial flow (index.js) calls the two separately
 * instead — see this module's doc comment above. */
export function seedMockSessions(personaId = 'swe') {
  prepareTutorialProvider(personaId);
  injectDemoSessions(personaId);
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

// Exit code `mycelium demo`'s child process uses to signal "tour finished,
// hand off to the real TUI" — distinct from plain 0 (quit early) or a crash.
export const DEMO_HANDOFF_EXIT_CODE = 42;

/**
 * Mounts the narrator overlay and drives it through STEPS. `app`'s sessions
 * view can be genuinely empty (expected in the real flow — the Scan step's
 * signal injects the mock data). `q` exits from anywhere immediately;
 * Escape is left alone (see onKeypress). `onDone(completed)` fires once,
 * `completed: true` only if `q` landed on the actual last step.
 * `reloadSessions`, if given, renders the Scan step's injection live —
 * omit for callers that pre-seeded via seedMockSessions(). `sessionsPreSeeded:
 * true` tells the Scan signal to skip injecting for those callers —
 * an explicit flag rather than a store check, since "a demo session exists
 * somewhere" is a much weaker signal than "this caller pre-seeded."
 */
export function startTutorial(app, onDone, personaId = 'swe', { reloadSessions, sessionsPreSeeded = false } = {}) {
  const persona = findPersona(personaId);
  const mergeFolder = persona.storylines[persona.mergeStorylineIndex].folder;
  const sessionCount = persona.storylines.reduce((n, s) => n + s.sessions.length, 0);
  const box = blessed.box({
    parent: app.screen,
    bottom: 1,
    left: 0,
    right: 0,
    // 'shrink', not a fixed height: a fixed height sized for a normal 1-2
    // line step silently truncated the last step's longer recap paragraph.
    // Anchored at `bottom` with no `top`, so a taller step grows upward.
    height: 'shrink',
    tags: true,
    padding: { left: 1, right: 1 },
    border: { type: 'line' },
    style: { border: { fg: C.spore }, fg: C.text },
  });

  // Baseline screen-child count right after mounting — any widget beyond
  // header/body/statusbar/toast means a picker/viewer opened a modal (all
  // `parent: app.screen`). app.isBusy() is also checked: `toast` is a
  // permanent child, so show()/hide() never moves the count, and Shift+M/S's
  // second auto-summarize spinner would otherwise read as "already closed."
  const baseline = app.screen.children.length;
  const isModalOpen = () => app.screen.children.length > baseline || app.isBusy();

  let i = 0;
  let done = false;
  let waiting = false; // true while polling for a real modal to open/close

  // app.js's screen.key(['q']) is a separate, always-on global binding —
  // suppress it for the tutorial's run so a stray `q` doesn't ALSO pop the
  // app's own confirm-quit dialog; restored once finish() runs. Doesn't
  // (and can't) suppress Ctrl+C, which stays a hard exit throughout.
  app.quitGuard = () => true;

  // scanner.js's scan() checks this to skip real adapters. cli.js's `demo`
  // command already sets it on its own child process, but first-run
  // onboarding runs in THIS process with nothing to set it ahead of time —
  // without this, a first-run `s` would call a real, unguarded scan() into
  // the same batch injectDemoSessions() is about to add. The real first-run
  // scan still happens once onboarding concludes (index.js's
  // startUpkeepAndRecheck), just not interleaved with the walkthrough.
  const prevDemoMode = process.env.MYCELIUM_DEMO_MODE;
  process.env.MYCELIUM_DEMO_MODE = '1';

  // Tutorial-only signal from sessions.js's action handlers. `action` is
  // one of 'scan'/'organize'/'knowledge'/'merge'/'split'; each real handler
  // fires it past its own guard checks. Cleared in finish(), same as
  // quitGuard. Scans forward from the current step for the first match,
  // same "human jumped ahead" tolerance as matchesWaitFor's own skip-ahead —
  // safe here since every action name is already unambiguous.
  let scanInjected = false;
  app.tutorialSignal = (action) => {
    if (done) return;
    // Runs BEFORE `waiting` and unconditionally: doScan()'s setImmediate
    // completion can land after another keypress already set `waiting`,
    // and the old combined `if (done || waiting) return;` silently dropped
    // it, leaving the Sessions view empty. scanInjected guards double-injection.
    if (action === 'scan' && !sessionsPreSeeded && !scanInjected) {
      scanInjected = true;
      injectDemoSessions(personaId);
      // reloadSessions is what makes a genuine injection visible immediately
      // rather than on the next unrelated re-render.
      reloadSessions?.();
    }
    if (waiting) return;
    let j = i;
    while (j < STEPS.length && STEPS[j].signalFor !== action) j++;
    if (j < STEPS.length) advanceFrom(j);
  };

  const render = () => {
    const step = STEPS[i];
    // "Step N/Total" computed from STEPS' own length/index, not baked into
    // each titleKey — those hold only the subtitle now, so inserting a step
    // never means renumbering every title in both locales.
    box.setLabel(` ${t('tutorial.stepCounter', i + 1, STEPS.length)}${t(step.titleKey)} `);
    // sessionCount/mergeFolder are passed to every step body; only a few
    // (step2/4/5/11, see i18n.js) actually read them.
    const body = waiting ? t(step.waitingKey) : t(step.bodyKey, C.fox, sessionCount, mergeFolder);
    // The last step's "q" hint differs: it hands off to real data instead
    // of abandoning the tour, and the generic exit hint read as contradictory.
    const exitOrFinishHint = i === STEPS.length - 1 ? t('tutorial.finishHint') : t('tutorial.exitHint');
    box.setContent(`${body}\n{${C.faint}-fg}${exitOrFinishHint}{/}`);
    // A real bug: this box mounts once, so any real widget opened later
    // (context viewer, multiSelectList, confirmText) draws on top of it
    // where they overlap, hiding the current step's guidance. setFront()
    // is a pure z-order move on every render, not a focus change.
    box.setFront();
    app.render();
  };

  const finish = (completed) => {
    if (done) return;
    done = true;
    app.tutorialSignal = null;
    app.screen.removeListener('keypress', onKeypress);
    // Deferred, not immediate: program.js fires 'keypress' and the global
    // quit binding's 'key q' synchronously back-to-back for the same press,
    // so clearing the guard here directly would still let that same q
    // trigger the app's own confirm-quit dialog right behind this.
    setImmediate(() => {
      app.quitGuard = null;
    });
    if (prevDemoMode === undefined) delete process.env.MYCELIUM_DEMO_MODE;
    else process.env.MYCELIUM_DEMO_MODE = prevDemoMode;
    box.destroy();
    endTutorial();
    app.render();
    onDone(!!completed);
  };

  const settleAt = (idx) => {
    waiting = false;
    i = idx;
    render();
    // pollOnEntry (merge's title-prompt step): blessed.prompt's Enter submit
    // doesn't reliably bubble a matching keypress here, so waitFor:'enter'
    // would never fire. Poll for close directly instead, no key needed.
    if (STEPS[i].pollOnEntry) pollUntil(STEPS[i].pollOnEntry === 'open');
  };

  // Polls until the real action's review modal opens/closes, then settles
  // on the next step. Still needed alongside app.tutorialSignal: the signal
  // only says the handler started, not that its LLM-backed modal has
  // actually appeared yet.
  const pollUntil = (want) => {
    const tick = () => {
      if (done) return;
      if (isModalOpen() === want) return settleAt(i + 1);
      setTimeout(tick, 250);
    };
    tick();
  };

  // Shared tail for "step j's trigger just fired" — used by both a matched
  // keypress (onKeypress below) and a matched app.tutorialSignal, so a step
  // reachable from the `.` action menu settles the exact same way regardless
  // of which path actually fired it.
  const advanceFrom = (j) => {
    i = j;
    const step = STEPS[i];
    if (step.thenWait) {
      waiting = true;
      render();
      pollUntil(step.thenWait === 'open');
    } else {
      settleAt(i + 1);
    }
  };

  // Shift+M/Shift+S arrive as key.name 'm'/'s' + key.shift:true, not
  // blessed's 'S-m' form, so a plain m/s must not satisfy a Shift step.
  // Punctuation like '.' has no k.name from readline's parser, only `ch`.
  const matchesWaitFor = (step, ch, k) =>
    !!step.waitFor && (k.name === step.waitFor || (!k.name && ch === step.waitFor)) && (!step.shift || k.shift);

  // Keys that mean something different almost everywhere (confirming any
  // dialog, plain navigation) never count toward skip-ahead — only an exact
  // match on the CURRENT step. Every step waiting on one of these is also
  // thenWait:'close', so a false-positive match elsewhere used to resolve
  // that wait instantly (no real modal ever closed) and cascade the
  // narrator forward. `o`/`w`/`c`/Shift+M/Shift+S are safe: each has exactly
  // one meaning and thenWait 'open', which only resolves on a real modal.
  // '.' is now waitFor for three steps by design — palette-intro up top,
  // then two more (n and h) mid-Reuse. Without this, a `.` on an earlier
  // step would forward-match one of those later ones and cascade the
  // narrator straight through, skipping the actual action in between.
  const AMBIGUOUS_KEYS = new Set(['enter', 'left', 'right', '.']);

  function onKeypress(ch, key) {
    if (done || !key) return;
    // neo-blessed fires TWO keypress events per physical Enter (synthetic
    // 'enter' then real 'return') — ignore the redundant half so an
    // 'enter' waitFor doesn't double-advance.
    if (key.name === 'return') return;
    // q exits from anywhere, immediately, checked before `waiting` so it
    // works mid-wait too. Only counts as "completed" (cli.js's demo hands
    // off to the real TUI) if pressed on the actual last step.
    if (key.name === 'q') return finish(i === STEPS.length - 1);
    // Real modal open/close waits always resolve on their own; only q above
    // should interrupt one.
    if (waiting) return;
    // Escape is deliberately not handled here — it used to double as
    // "abort," so closing a real modal with Escape silently ended the tutorial.
    let j = i;
    if (!matchesWaitFor(STEPS[j], ch, key)) {
      // Punctuation keys arrive with key.name undefined (see matchesWaitFor's
      // ch fallback), so check both when deciding what's ambiguous.
      if (AMBIGUOUS_KEYS.has(key.name) || (!key.name && AMBIGUOUS_KEYS.has(ch))) return;
      while (j < STEPS.length && !matchesWaitFor(STEPS[j], ch, key)) j++;
      if (j >= STEPS.length) return;
    }
    advanceFrom(j);
  }

  app.screen.on('keypress', onKeypress);
  render();
}
