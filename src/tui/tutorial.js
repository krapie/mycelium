import pkg from 'neo-blessed';
const blessed = pkg.default || pkg;
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { C } from './theme.js';
import { getLocale } from './i18n.js';
import { saveRaw, deleteRaw, allRaw } from '../scanner.js';
import { reindex } from '../index-db.js';
import { pruneEmptyFolders } from '../cleanup.js';
import { buildMockSessions } from './tutorial-data.js';
import { __setTestProvider, __clearTestProvider } from '../llm.js';
import { createTutorialMockProvider } from './tutorial-mock-llm.js';
import { findPersona } from './personas.js';
import { writePendingKnowledgeText } from '../insight.js';
import { HOME } from '../paths.js';
import { createContext, render, advanceFrom, onKeypress } from './tutorial-runner.js';

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
  // Reuse: `n` (real agent picker -> directory picker -> copy the launch
  // command) rather than `c`'s read-only preview — shows the actual
  // mechanism, not just a description of it. copyOnly:true (doNewAgent(),
  // sessions.js) means the flow never risks foregrounding a real agent
  // subprocess. Step 8 uses `pollOnEntry`, not a tracked waitFor key, since
  // the picker chain (agent -> directory) has no single close key of its
  // own to wait on — same reasoning the old c/textView step used.
  { titleKey: 'tutorial.step7Title', bodyKey: 'tutorial.step7Body', waitFor: 'n', signalFor: 'newAgent', thenWait: 'open', waitingKey: 'tutorial.waitingLaunch' },
  { titleKey: 'tutorial.step8Title', bodyKey: 'tutorial.step8Body', pollOnEntry: 'close' },
  // Lands right where the user just watched a real AGENTS.md get written —
  // names why that mattered (Claude Code prunes old sessions, Codex/Kiro
  // don't) as its own beat instead of folding it into step 8's body. No
  // real action to demonstrate here, so waitFor 'enter' piggybacks on
  // Sessions' own real Enter-to-drill-in binding rather than gating on a
  // key with no effect underneath, same reasoning as the intro step above.
  { titleKey: 'tutorial.step9Title', bodyKey: 'tutorial.step9Body', waitFor: 'enter' },
  // Knowledge review (`k`) — deliberately unrelated to Digest (`d`),
  // positioned here as the natural "faster, across every folder" follow-up.
  // Structurally identical to steps 2/3: a real multiSelectList opens either
  // way, so the same thenWait:'open'/'close' pair works with no new mechanism.
  { titleKey: 'tutorial.step10Title', bodyKey: 'tutorial.step10Body', waitFor: 'k', thenWait: 'open', waitingKey: 'tutorial.waitingKnowledgeReview' },
  { titleKey: 'tutorial.step11Title', bodyKey: 'tutorial.step11Body', waitFor: 'enter', thenWait: 'close', waitingKey: 'tutorial.waitingApply' },
  // Session lineage: merge two related sessions, then split the result back
  // apart by topic — both reversible, same as the real feature.
  // mergeSessions() needs no mocking; Shift+S's suggestSplitBoundaries()
  // does. Shift+M no-ops silently unless ≥2 sessions are already selected —
  // nothing here can verify that happened, same as any other step's text.
  { titleKey: 'tutorial.step12Title', bodyKey: 'tutorial.step12Body', waitFor: 'm', shift: true, signalFor: 'merge', thenWait: 'open', waitingKey: 'tutorial.waitingMerge' },
  { titleKey: 'tutorial.step13Title', bodyKey: 'tutorial.step13Body', pollOnEntry: 'close' },
  { titleKey: 'tutorial.step14Title', bodyKey: 'tutorial.step14Body', waitFor: 's', shift: true, signalFor: 'split', thenWait: 'open', waitingKey: 'tutorial.waitingSplit' },
  { titleKey: 'tutorial.step15Title', bodyKey: 'tutorial.step15Body', waitFor: 'enter', thenWait: 'close', waitingKey: 'tutorial.waitingApply' },
  // This step's whole point is "go try the real thing" (v for the calendar,
  // / for search) — both of those use Escape themselves for normal back-
  // navigation (calendar/detail → sessions), which just works: Escape is
  // never intercepted by the tutorial at all (see onKeypress below), on any
  // step, not just this one.
  { titleKey: 'tutorial.step16Title', bodyKey: 'tutorial.step16Body', waitFor: 'enter' },
  // No waitFor at all — q is handled once, globally, at the top of
  // onKeypress, the same way on every step including this one. This step is
  // just the last thing shown before that q lands.
  { titleKey: 'tutorial.step17Title', bodyKey: 'tutorial.step17Body' },
];

/** A real, disposable directory every mock session's `projectDir` points at
 * — sibling to HOME (`${HOME}-tutorial-repo`).
 * Gives the `n` step's directory picker (dirsForFolder(), reuse.js) a real
 * suggestion to offer instead of falling through to a free-text prompt
 * pre-filled with wherever the user happened to launch mycelium from — and
 * gives its own "go check the real AGENTS.md" instruction somewhere real
 * (but fake) to point at, never the user's actual project. Exported so
 * tests can assert on the exact path rather than recomputing the string
 * themselves. */
export function tutorialProjectDir() {
  return `${HOME}-tutorial-repo`;
}

// This is a fixed, predictable path (found via CodeRabbit review on #97) —
// if it happened to already exist as some unrelated real directory (the
// user's own, or a leftover from something else entirely), endTutorial()'s
// rmSync() would otherwise destroy it. The marker records "the tutorial
// itself created this directory," written only when injectDemoSessions()
// finds nothing there yet — endTutorial() then only ever removes a
// directory carrying its own marker, never a pre-existing one.
const OWNERSHIP_MARKER = '.mycelium-tutorial-owned';

/** Writes the persona's mock sessions to the store — the one visible part
 * of setup, split out so the tutorial flow can defer it to the Scan step's
 * signal instead of showing it before the tour starts. NOT idempotent —
 * buildMockSessions() stamps a fresh id per call, so callers that might run
 * after a caller-side seedMockSessions() must check for existing demo
 * sessions first. */
export function injectDemoSessions(personaId = 'swe') {
  const dir = tutorialProjectDir();
  // mkdirSync(recursive:true) itself is the ownership check, not a separate
  // existsSync() before it (found via CodeRabbit review on #97) — Node
  // returns the created path when it actually made the directory, or
  // undefined when it already existed, with no gap between "check" and
  // "act" for another process to have created it in between.
  const created = mkdirSync(dir, { recursive: true });
  if (created) writeFileSync(join(dir, OWNERSHIP_MARKER), '');
  for (const n of buildMockSessions(personaId, undefined, dir)) saveRaw(n);
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
 * the way) — leaves the real store exactly as it was before the tutorial.
 * Also removes tutorialProjectDir() — the `n` step's AGENTS.md write is a
 * real file on disk, outside ~/.mycelium entirely, so it needs its own
 * cleanup here rather than anything reindex()/pruneEmptyFolders() already
 * cover. Only removes it if OWNERSHIP_MARKER is present (this tutorial run
 * created it fresh, see injectDemoSessions()) — never a directory that
 * happened to already exist at that fixed, predictable path. A tutorial
 * that never reached the `n` step never created the directory (or the
 * marker) at all, so this is just a no-op then. */
export function endTutorial() {
  for (const n of allRaw()) {
    if (n.demo) deleteRaw(n.id);
  }
  pruneEmptyFolders();
  reindex();
  __clearTestProvider();
  const dir = tutorialProjectDir();
  if (existsSync(join(dir, OWNERSHIP_MARKER))) rmSync(dir, { recursive: true, force: true });
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

  // The step-cursor/waiting/done state and the render/finish/settleAt/
  // pollUntil/advanceFrom/onKeypress step-walking engine live in
  // tutorial-runner.js (ctx is the shared mutable state they all read/write) —
  // this function is setup/wiring only. endTutorial is injected via ctx
  // rather than imported by that module, to avoid a circular import.
  const ctx = createContext({ app, box, STEPS, mergeFolder, sessionCount, baseline, isModalOpen, onDone, endTutorial, prevDemoMode });
  ctx.keypressHandler = (ch, key) => onKeypress(ctx, ch, key);

  // Tutorial-only signal from sessions.js's action handlers. `action` is
  // one of 'scan'/'organize'/'knowledge'/'merge'/'split'; each real handler
  // fires it past its own guard checks. Cleared in finish(), same as
  // quitGuard. Scans forward from the current step for the first match,
  // same "human jumped ahead" tolerance as matchesWaitFor's own skip-ahead —
  // safe here since every action name is already unambiguous.
  app.tutorialSignal = (action) => {
    if (ctx.done) return;
    // Runs BEFORE `waiting` and unconditionally: doScan()'s setImmediate
    // completion can land after another keypress already set `waiting`,
    // and the old combined `if (done || waiting) return;` silently dropped
    // it, leaving the Sessions view empty. scanInjected guards double-injection.
    if (action === 'scan' && !sessionsPreSeeded && !ctx.scanInjected) {
      ctx.scanInjected = true;
      injectDemoSessions(personaId);
      // reloadSessions is what makes a genuine injection visible immediately
      // rather than on the next unrelated re-render.
      reloadSessions?.();
    }
    if (ctx.waiting) return;
    let j = ctx.i;
    while (j < STEPS.length && STEPS[j].signalFor !== action) j++;
    if (j < STEPS.length) advanceFrom(ctx, j);
  };

  app.screen.on('keypress', ctx.keypressHandler);
  render(ctx);
}
