import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from '../helpers.js';
import { createTestApp, sendKey, sendKeys, waitFor } from '../tui-helpers.js';

// Drives the REAL app (real createApp()/sessionsView()/startTutorial()
// handlers, real data layer) against fake input/output streams instead of
// a real TTY — see tui-helpers.js's module comment for why real bytes
// (not synthetic keypress objects) are required for this to actually
// exercise sessions.js's key bindings, not just tutorial.js's own raw
// listener. This is the automated equivalent of the tmux-based manual
// verification this repo's demo/tutorial changes have relied on — it
// would have caught the panel-focus (c/i list-only binding), merge-folder,
// and split-defaultAll regressions found that way during development.
//
// Deliberately not asserting rendered pixel/ANSI output anywhere — that's
// fragile and low-value. Every assertion here is against real resulting
// state: session records, KNOWLEDGE.md file contents, the tutorial's own
// onDone(completed) callback. MYCELIUM_DEMO_MOCK_DELAY_MS is set low so
// the suite doesn't wait out the real ~5s production delay per LLM-bound
// step.

useTempHome();
process.env.MYCELIUM_DEMO_MOCK_DELAY_MS = '15';

const { allRaw } = await import('../../src/scanner.js');
const { TREE_DIR } = await import('../../src/paths.js');
const { createApp } = await import('../../src/tui/app.js');
const { sessionsView } = await import('../../src/tui/views/sessions.js');
const { seedMockSessions, startTutorial } = await import('../../src/tui/tutorial.js');

function findByKeyword(sessions, re) {
  return sessions.filter((s) => re.test(s.extracted.summary || ''));
}

// Reads the narrator overlay's own step number straight off its blessed
// label content (tutorial.js's `box.setLabel(...)`, e.g. " Step 3/14 ") —
// not rendered pixel/ANSI output, just the plain string setLabel()/
// setContent() already stored on the element (element.js's `_label.content`
// / `.content`). Needed only for the skip-ahead regression test below,
// where the thing actually under test IS which step the narrator thinks
// it's on, not just whether some real handler ran.
function narratorStepIndex(app) {
  const box = app.screen.children.find((c) => c._label && /Step \d+\/14/.test(c._label.content || ''));
  if (!box) return null;
  const m = /Step (\d+)\/14/.exec(box._label.content);
  return m ? Number(m[1]) : null;
}

// Mounts the real sessions view against a fake terminal, seeded with the
// real 6-session SWE persona demo dataset (explicit personaId so this stays
// stable regardless of what personas.js's default happens to be). Returns
// { app, input, api } — api is sessionsView's own exposed state/handles
// (see sessions.js's this._api / opts.onReady), used here only to read
// state.folder for assertions/navigation checks, never to shortcut past
// real keypresses.
async function mountDemo(personaId = 'swe') {
  seedMockSessions(personaId);
  const { input, output } = createTestApp();
  const app = createApp({ input, output });
  let api;
  await app.show(sessionsView({ onReady: (a) => (api = a) }));
  return { app, input, api };
}

function cleanup(app) {
  app.screen.destroy();
}

test('demo: full lifecycle walkthrough — organize, learn, reuse, merge, split, exit', async () => {
  const { app, input, api } = await mountDemo();
  try {
    // Step 1 — panel navigation: → moves focus off Folders onto Sessions
    // (o is a screenKey(), works regardless of focus — this step is about
    // setting up the SAME focus state the real tutorial's step 4 depends
    // on, not about o itself).
    sendKey(input, 'right');
    await new Promise((r) => setTimeout(r, 30));

    // Step 2 — o: real suggestPlacements() call (mocked) classifies all 6
    // unfiled demo sessions (SWE persona — see personas.js). Wait for the
    // real side effect (suggestedFolder queued on every candidate) rather
    // than a fixed delay.
    const baseline = app.screen.children.length;
    sendKey(input, 'o');
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 3000 });

    const reorder = findByKeyword(allRaw(), /reorder|order history|checkout/i);
    const cartRounding = findByKeyword(allRaw(), /cart total|rounding|floating.?point/i);
    const imageLoading = findByKeyword(allRaw(), /lazy.?load|largest contentful paint|lcp/i);
    assert.equal(reorder.length, 2, 'both express-reorder sessions found');
    for (const s of reorder) assert.equal(s.suggestedFolder, 'retail-website/express-reorder');
    for (const s of cartRounding) assert.equal(s.suggestedFolder, 'retail-website/cart-rounding-fix');
    for (const s of imageLoading) assert.equal(s.suggestedFolder, 'retail-website/image-lazy-loading');

    // Step 3 — Enter: apply the (all-checked-by-default) placements.
    sendKey(input, 'enter');
    await waitFor(() => app.screen.children.length === baseline, { timeoutMs: 2000 });
    assert.equal(
      allRaw().find((s) => s.id === reorder[0].id).folder,
      'retail-website/express-reorder',
      'placement actually applied, not just suggested',
    );

    // Step 4 — ←: back to Folders (real fix for the panel-focus bug —
    // organize's apply flow leaves focus on Sessions, so this is required
    // before folder-list navigation means anything). Then walk down to
    // retail-website/express-reorder (Root → New → retail-website →
    // cart-rounding-fix → express-reorder, alphabetical) and open it.
    sendKey(input, 'left');
    await sendKeys(input, ['down', 'down', 'down', 'down'], 30);
    await waitFor(() => api.state.folder === 'retail-website/express-reorder', { timeoutMs: 1000 });
    sendKey(input, 'enter');
    await new Promise((r) => setTimeout(r, 30));

    // Step 5/6 — w: real buildKnowledgeText() call (mocked), then Enter to
    // save. Assert the REAL file on disk, not just the in-memory preview.
    const baseline2 = app.screen.children.length;
    sendKey(input, 'w');
    await waitFor(() => app.screen.children.length > baseline2, { timeoutMs: 3000 });
    sendKey(input, 'enter');
    await waitFor(() => app.screen.children.length === baseline2, { timeoutMs: 2000 });
    const knowledge = readFileSync(join(TREE_DIR, 'retail-website', 'express-reorder', 'KNOWLEDGE.md'), 'utf8');
    assert.match(knowledge, /Express Reorder/);
    assert.doesNotMatch(knowledge, /[가-힣]/, 'demo knowledge output must be English');

    // Step 7/8 — c: real assembleContext() call (no LLM, instant) — then
    // close with Escape (regression test: this used to also abort the
    // whole tutorial as a side effect of textView's own close behavior;
    // here we're driving sessionsView directly, not startTutorial, so the
    // only thing to verify is that Escape closes the real modal).
    const baseline3 = app.screen.children.length;
    sendKey(input, 'c');
    await waitFor(() => app.screen.children.length > baseline3, { timeoutMs: 1000 });
    sendKey(input, 'escape');
    await waitFor(() => app.screen.children.length === baseline3, { timeoutMs: 1000 });

    // Step 9/10 — select both express-reorder sessions (backend + frontend),
    // Shift+M merge. No LLM call — mergeSessions() is synchronous, so no
    // poll needed, just a settle. A literal uppercase char over the raw
    // byte stream arrives as key.name:'m' + key.shift:true, exactly like a
    // real terminal — that's what listBox.key('S-m', ...) actually matches
    // internally.
    sendKey(input, 'space');
    sendKey(input, 'down');
    sendKey(input, 'space');
    sendKey(input, 'M');
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(app.screen.children.length > baseline3, 'Shift+M opened the merge title prompt');
    sendKey(input, 'enter'); // accept default title
    await waitFor(() => allRaw().some((s) => s.mergedFrom?.length === 2), { timeoutMs: 2000 });
    const merged = allRaw().find((s) => s.mergedFrom?.length === 2);
    assert.equal(
      merged.folder,
      'retail-website/express-reorder',
      'merge kept the shared folder instead of landing unfiled — regression test',
    );

    // Step 11/12 — Shift+S split (mocked LLM), then bare Enter (regression
    // test: split's review list must default-select everything, or a bare
    // Enter here would apply nothing).
    const baseline4 = app.screen.children.length;
    sendKey(input, 'S');
    await waitFor(() => app.screen.children.length > baseline4, { timeoutMs: 3000 });
    sendKey(input, 'enter');
    await waitFor(() => allRaw().some((s) => s.splitFrom === merged.id), { timeoutMs: 2000 });
    const pieces = allRaw().filter((s) => s.splitFrom === merged.id);
    assert.equal(pieces.length, 2, 'both split pieces created and visible — regression test');
    for (const p of pieces) assert.equal(p.folder, 'retail-website/express-reorder');
  } finally {
    cleanup(app);
  }
});

test('demo (cse persona): 3-way merge across DX/VPC/ALB sessions, then split — exercises the dynamic turn-count split fix', async () => {
  // The CSE persona's merge storyline is a 3-way merge (not 2), the exact
  // case a hardcoded {1,2}/{3,4} split range used to silently drop turns
  // for once there were more than 4 total. mergeSessions() itself needed no
  // change (already supported ids.length >= 2) — this is really a
  // regression test for mockSplit()'s dynamic turn-count parsing.
  const { app, input, api } = await mountDemo('cse');
  try {
    sendKey(input, 'right');
    await new Promise((r) => setTimeout(r, 30));

    const baseline = app.screen.children.length;
    sendKey(input, 'o');
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 3000 });
    sendKey(input, 'enter');
    await waitFor(() => app.screen.children.length === baseline, { timeoutMs: 2000 });

    // Root → New → cases → onprem-connectivity (alphabetically before s3-cross-account).
    sendKey(input, 'left');
    await sendKeys(input, ['down', 'down', 'down'], 30);
    await waitFor(() => api.state.folder === 'cases/onprem-connectivity', { timeoutMs: 1000 });
    sendKey(input, 'enter');
    await new Promise((r) => setTimeout(r, 30));

    // Select all 3 sessions (DX, VPC, ALB) and merge. Fixed settle (not
    // waitFor) after M, matching the 2-session merge test above — blessed's
    // prompt widget isn't reliably ready to receive Enter the instant the
    // screen-child count changes, so polling for that and firing Enter
    // immediately on the transition can race and drop the keypress.
    const baseline2 = app.screen.children.length;
    sendKey(input, 'space');
    sendKey(input, 'down');
    sendKey(input, 'space');
    sendKey(input, 'down');
    sendKey(input, 'space');
    sendKey(input, 'M');
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(app.screen.children.length > baseline2, 'Shift+M opened the merge title prompt');
    sendKey(input, 'enter'); // accept default title
    await waitFor(() => allRaw().some((s) => s.mergedFrom?.length === 3), { timeoutMs: 2000 });
    const merged = allRaw().find((s) => s.mergedFrom?.length === 3);
    assert.equal(merged.folder, 'cases/onprem-connectivity', '3-way merge kept the shared folder');
    // 3 source sessions x 4 turns each, plus mergeSessions()'s own
    // provenance separator turn before each block (see organize/lineage.js).
    assert.equal(merged.turns.length, 15, 'merged record has every turn from all 3 source sessions');

    // Shift+S split — with the old hardcoded {1,2}/{3,4} ranges this would
    // have silently discarded everything past turn 4.
    const baseline3 = app.screen.children.length;
    sendKey(input, 'S');
    await waitFor(() => app.screen.children.length > baseline3, { timeoutMs: 3000 });
    sendKey(input, 'enter');
    await waitFor(() => allRaw().some((s) => s.splitFrom === merged.id), { timeoutMs: 2000 });
    const pieces = allRaw().filter((s) => s.splitFrom === merged.id);
    assert.equal(pieces.length, 2, 'both split pieces created');
    for (const p of pieces) assert.equal(p.folder, 'cases/onprem-connectivity');
    const totalSplitTurns = pieces.reduce((n, p) => n + p.turns.length, 0);
    assert.equal(totalSplitTurns, 15, 'every one of the merged turns landed in a split piece — none silently dropped');
  } finally {
    cleanup(app);
  }
});

test('demo: an impatient double Shift+S while the LLM call is in flight does not stack a second review modal', async () => {
  // Regression test: doSplit() (and o/w) used to have no re-entrancy guard
  // — pressing Shift+S again before the first suggestSplitBoundaries() call
  // resolved started a SECOND concurrent run, eventually opening a SECOND
  // multiSelectList on top of the first (both `parent: app.screen`).
  // Closing just the top one left the other still parented underneath, so
  // anything watching screen.children.length against a pre-press baseline
  // (the tutorial's own isModalOpen()) never saw it drop back to baseline —
  // stuck waiting for a "close" that could never fully arrive. Fixed via
  // sessions.js's asyncReviewFlowRunning guard, shared across o/w/Shift+S.
  const { app, input } = await mountDemo();
  try {
    sendKey(input, 'right'); // focus onto the Sessions list
    await new Promise((r) => setTimeout(r, 30));
    const baseline = app.screen.children.length;

    // Two Shift+S presses back to back, well inside the 15ms mock delay
    // (MYCELIUM_DEMO_MOCK_DELAY_MS, set at the top of this file) — the
    // second press must be a no-op, not a second concurrent run.
    sendKey(input, 'S');
    sendKey(input, 'S');
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 3000 });
    assert.equal(app.screen.children.length, baseline + 1, 'only one review modal opened, not two stacked on top of each other');

    sendKey(input, 'enter'); // defaultAll — applies every proposed range
    await waitFor(() => app.screen.children.length === baseline, { timeoutMs: 2000 });
    assert.equal(app.screen.children.length, baseline, 'closing the (single) modal returns exactly to baseline — nothing left stacked underneath');
    assert.ok(allRaw().some((s) => s.splitFrom), 'the split actually applied');
  } finally {
    cleanup(app);
  }
});

test('demo: q exits the tutorial immediately from any step, no confirm dialog', async () => {
  const { app, input } = await mountDemo();
  try {
    let doneArg;
    startTutorial(app, (completed) => {
      doneArg = completed;
    });
    // Step 1 (panel navigation) — q here is an early exit, not a completed run.
    sendKey(input, 'q');
    await waitFor(() => doneArg !== undefined, { timeoutMs: 1000 });
    assert.equal(doneArg, false, 'q on an early step is not a "completed" run — no demo→real handoff');
    assert.equal(allRaw().filter((s) => s.demo).length, 0, 'endTutorial() cleanup ran');
  } finally {
    cleanup(app);
  }
});

test('demo: Escape does not abort the tutorial when no modal is open', async () => {
  const { app, input } = await mountDemo();
  try {
    let doneArg = 'not called';
    startTutorial(app, (completed) => {
      doneArg = completed;
    });
    sendKey(input, 'escape');
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(doneArg, 'not called', 'Escape must not end the tutorial on its own');
    assert.ok(allRaw().some((s) => s.demo), 'demo sessions are still there — tutorial is still running');
  } finally {
    cleanup(app);
  }
});

test('demo: finishing the tutorial on the actual last step reports completed:true', async () => {
  const { app, input } = await mountDemo();
  try {
    let doneArg;
    startTutorial(app, (completed) => {
      doneArg = completed;
    });
    // The narrator's own pollUntil() checks every 250ms (see tutorial.js) —
    // independent of, and slower than, this test's own waitFor() (20ms
    // interval) on the real screen/data state. A real modal can close well
    // before the narrator's next poll tick notices, so a key sent purely on
    // "the real state already changed" can arrive while the narrator is
    // still mid-poll and get swallowed by its `waiting` gate, silently
    // leaving it one step behind for the rest of the run. settle() pads
    // every narrator-tracked transition past that 250ms cadence before the
    // next key goes out.
    const settle = () => new Promise((r) => setTimeout(r, 320));

    // Full key sequence, mirroring the walkthrough test above, all the way
    // through the tutorial's own final step.
    sendKey(input, 'right');
    await settle();
    let baseline = app.screen.children.length;
    sendKey(input, 'o');
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 3000 });
    await settle();
    sendKey(input, 'enter');
    await waitFor(() => app.screen.children.length === baseline, { timeoutMs: 2000 });
    await settle();
    sendKey(input, 'left');
    await settle();
    await sendKeys(input, ['down', 'down', 'down', 'down'], 30);
    sendKey(input, 'enter');
    await settle();
    baseline = app.screen.children.length;
    sendKey(input, 'w');
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 3000 });
    await settle();
    sendKey(input, 'enter');
    await waitFor(() => app.screen.children.length === baseline, { timeoutMs: 2000 });
    await settle();
    baseline = app.screen.children.length;
    sendKey(input, 'c');
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 1000 });
    await settle();
    sendKey(input, 'escape');
    await waitFor(() => app.screen.children.length === baseline, { timeoutMs: 1000 });
    await settle();
    sendKey(input, 'space');
    sendKey(input, 'down');
    sendKey(input, 'space');
    sendKey(input, 'M');
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 2000 });
    await settle();
    sendKey(input, 'enter');
    await waitFor(() => allRaw().some((s) => s.mergedFrom?.length === 2), { timeoutMs: 2000 });
    await settle();
    baseline = app.screen.children.length;
    sendKey(input, 'S');
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 3000 });
    await settle();
    sendKey(input, 'enter');
    await waitFor(() => app.screen.children.length === baseline, { timeoutMs: 2000 });
    await settle();
    // freeform explore step, then the final step — both just need Enter/q.
    sendKey(input, 'enter');
    await settle();
    sendKey(input, 'q');
    await waitFor(() => doneArg !== undefined, { timeoutMs: 1000 });
    assert.equal(doneArg, true, 'q on the actual last step is a completed run — triggers the demo→real handoff');
    assert.equal(allRaw().filter((s) => s.demo).length, 0, 'endTutorial() cleanup ran');
  } finally {
    cleanup(app);
  }
});

test('demo: pressing a later step\'s key early (skipping step 1) still lets the narrator catch up to the real last step', async () => {
  // Regression test: onKeypress() used to only check the CURRENT step's own
  // waitFor. Since this listener never gates sessions.js's real handlers
  // (it only narrates alongside them), a human who pressed `o` right away
  // — before ever pressing step 1's `→` — still triggered the real
  // suggestPlacements() call, but the narrator had no matching waitFor for
  // `o` on step 1 and was left permanently stuck there, one press behind,
  // for the rest of the run. tutorial.js's onKeypress() now scans forward
  // from the current step for the first one `o` actually satisfies and
  // jumps straight there. If that regressed, `doneArg` below would be
  // false (or the run would never finish) even though every real action
  // still completes normally — same proxy the "actual last step" test above
  // uses, just entered out of order.
  const { app, input } = await mountDemo();
  try {
    let doneArg;
    startTutorial(app, (completed) => {
      doneArg = completed;
    });
    const settle = () => new Promise((r) => setTimeout(r, 320));

    // No `right` here — step 1's own key is skipped entirely.
    let baseline = app.screen.children.length;
    sendKey(input, 'o');
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 3000 });
    await settle();
    sendKey(input, 'enter');
    await waitFor(() => app.screen.children.length === baseline, { timeoutMs: 2000 });
    await settle();
    sendKey(input, 'left');
    await settle();
    await sendKeys(input, ['down', 'down', 'down', 'down'], 30);
    sendKey(input, 'enter');
    await settle();
    baseline = app.screen.children.length;
    sendKey(input, 'w');
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 3000 });
    await settle();
    sendKey(input, 'enter');
    await waitFor(() => app.screen.children.length === baseline, { timeoutMs: 2000 });
    await settle();
    baseline = app.screen.children.length;
    sendKey(input, 'c');
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 1000 });
    await settle();
    sendKey(input, 'escape');
    await waitFor(() => app.screen.children.length === baseline, { timeoutMs: 1000 });
    await settle();
    sendKey(input, 'space');
    sendKey(input, 'down');
    sendKey(input, 'space');
    sendKey(input, 'M');
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 2000 });
    await settle();
    sendKey(input, 'enter');
    await waitFor(() => allRaw().some((s) => s.mergedFrom?.length === 2), { timeoutMs: 2000 });
    await settle();
    baseline = app.screen.children.length;
    sendKey(input, 'S');
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 3000 });
    await settle();
    sendKey(input, 'enter');
    await waitFor(() => app.screen.children.length === baseline, { timeoutMs: 2000 });
    await settle();
    sendKey(input, 'enter');
    await settle();
    sendKey(input, 'q');
    await waitFor(() => doneArg !== undefined, { timeoutMs: 1000 });
    assert.equal(doneArg, true, 'narrator caught up all the way to the real last step despite step 1 being skipped');
    assert.equal(allRaw().filter((s) => s.demo).length, 0, 'endTutorial() cleanup ran');
  } finally {
    cleanup(app);
  }
});

test('demo: a stray Enter on step 1 does not falsely cascade the narrator forward', async () => {
  // Regression test for a bug the skip-ahead fix above (allowing `o` to
  // reach step 2/3 early) itself introduced: 'enter' is step 3/6/12/13's
  // waitFor too, so scanning forward for ANY future step sharing the
  // pressed key's name let a completely unrelated Enter (e.g. drilling
  // into a row, dismissing something) falsely match one of those later
  // steps. Worse, step 3/6/12 are all thenWait:'close', and isModalOpen()
  // is already false whenever nothing happens to be open — so that
  // false-positive match resolved its "wait for close" instantly (no real
  // modal ever had to close), landing on the step after that with zero
  // corresponding real action. `enter`/`left`/`right` are now excluded
  // from the forward scan entirely (see tutorial.js's AMBIGUOUS_KEYS) —
  // only an exact match on the CURRENT step counts for those.
  const { app, input } = await mountDemo();
  try {
    let doneArg;
    startTutorial(app, (completed) => {
      doneArg = completed;
    });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(narratorStepIndex(app), 1, 'starts on step 1');

    sendKey(input, 'enter');
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(narratorStepIndex(app), 1, 'a stray Enter must not advance the narrator past step 1');

    // The actual skip-ahead fix (a distinctive key like `o`) must still work.
    const baseline = app.screen.children.length;
    sendKey(input, 'o');
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 3000 });
    await new Promise((r) => setTimeout(r, 320));
    assert.equal(narratorStepIndex(app), 3, 'o still correctly skips ahead once the real organize modal opens');
    assert.equal(doneArg, undefined, 'tutorial is still running');
  } finally {
    cleanup(app);
  }
});
