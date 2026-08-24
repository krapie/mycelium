import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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

const { allRaw, saveRaw } = await import('../../src/scanner.js');
const { emptyNeutral } = await import('../../src/schema.js');
const { TREE_DIR } = await import('../../src/paths.js');
const { createApp } = await import('../../src/tui/app.js');
const { sessionsView } = await import('../../src/tui/views/sessions.js');
const { seedMockSessions, prepareTutorialProvider, startTutorial } = await import('../../src/tui/tutorial.js');
const { setLocale } = await import('../../src/tui/i18n.js');
const { writePendingKnowledgeText, pendingKnowledgeReviews, dismissPendingKnowledge } = await import('../../src/insight.js');
const { queueSuggestions } = await import('../../src/organize.js');
const { __clearTestProvider } = await import('../../src/llm.js');

// seedMockSessions()/createTutorialMockProvider() default their locale to
// i18n.js's getLocale() — setLocale('ko') (used by exactly one test below)
// mutates that same module-level state every other test in this process
// would otherwise also see, since node's test runner shares one process per
// file. Reset after every test, not just the one that sets it, so a test
// order change can't leak Korean into an English-content assertion.
//
// __clearTestProvider() too: prepareTutorialProvider()/seedMockSessions()
// call __setTestProvider() directly (not through startTutorial()), and
// endTutorial()'s own __clearTestProvider() only runs if a test drives the
// tutorial all the way to completion (q or the final step) — a test that
// stops partway (e.g. to assert mid-tutorial state) would otherwise leave a
// stale mock provider active for whatever runs after it in this shared
// process. Harmless in practice (every test in this file only ever calls
// llm.js's complete() through one of these mock providers, never a real
// subprocess), but cheap to clean up properly regardless.
//
// MYCELIUM_DEMO_MODE too, same reasoning: startTutorial() sets it for its
// own lifetime and restores it in finish() (see tutorial.js), but finish()
// only runs if a test drives the tutorial to completion — a test that
// mounts one and stops partway (many in this file do, deliberately, to
// assert mid-tutorial state) leaves it set to '1' for whatever runs next,
// and a later test's own scan() call would then silently skip real
// adapters in demo mode without ever setting that up itself. Captured once
// here (the file's own ambient value before any test ever runs, almost
// always undefined) and restored to exactly that after every test, rather
// than unconditionally deleted — the same save/restore shape
// startTutorial() itself uses, in case something outside this file ever
// legitimately has it set before the suite starts.
const initialDemoMode = process.env.MYCELIUM_DEMO_MODE;
test.afterEach(() => {
  setLocale('en');
  __clearTestProvider();
  if (initialDemoMode === undefined) delete process.env.MYCELIUM_DEMO_MODE;
  else process.env.MYCELIUM_DEMO_MODE = initialDemoMode;
});

function findByKeyword(sessions, re) {
  return sessions.filter((s) => re.test(s.extracted.summary || ''));
}

// Reads the narrator overlay's own step number straight off its blessed
// label content (tutorial.js's `box.setLabel(...)`, e.g. " Step 3/16 ") —
// not rendered pixel/ANSI output, just the plain string setLabel()/
// setContent() already stored on the element (element.js's `_label.content`
// / `.content`). Needed only for the skip-ahead regression test below,
// where the thing actually under test IS which step the narrator thinks
// it's on, not just whether some real handler ran.
function narratorStepIndex(app) {
  const box = app.screen.children.find((c) => c._label && /Step \d+\/\d+/.test(c._label.content || ''));
  if (!box) return null;
  const m = /Step (\d+)\/\d+/.exec(box._label.content);
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
    // Shift+M merge. mergeSessions() itself is synchronous, but the handler
    // now also auto-summarizes the result (autoTagSession(), same mocked
    // LLM as everything else) — waitFor()s below poll real state either way,
    // so this doesn't need special-casing. A literal uppercase char over the
    // raw byte stream arrives as key.name:'m' + key.shift:true, exactly like
    // a real terminal — that's what listBox.key('S-m', ...) actually matches
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
    // Auto-summarize runs AFTER the UI already recovered (see sessions.js) —
    // give it a moment past the mock's own delay before checking the result.
    await waitFor(() => !!allRaw().find((s) => s.id === merged.id)?.extracted.summary, { timeoutMs: 2000 });
    assert.ok(
      allRaw().find((s) => s.id === merged.id).extracted.summary,
      'merge auto-summarizes the result — regression test for the "merge produces an empty session" complaint',
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
    // Same auto-summarize check, for each split piece this time.
    await waitFor(
      () => allRaw().filter((s) => s.splitFrom === merged.id).every((p) => p.extracted.summary),
      { timeoutMs: 2000 },
    );

    // Shift+S on a split PIECE reverts the whole split instead of proposing
    // a fresh one — reloadList() after applying the split doesn't pin the
    // cursor to any particular row, so navigate to a known piece explicitly
    // rather than assume where it landed. unsplit()/unmerge() used to be
    // CLI-only — this is the TUI-reachable path the split.done toast above
    // has pointed at since `mycelium unsplit <id>` was added.
    for (let i = 0; i < 10 && api.row?.id !== pieces[0].id; i++) await sendKeys(input, ['down'], 20);
    assert.equal(api.row?.id, pieces[0].id, 'navigated the cursor onto a split piece');
    const baseline5 = app.screen.children.length;
    sendKey(input, 'S');
    await waitFor(() => allRaw().filter((s) => s.splitFrom === merged.id).length === 0, { timeoutMs: 2000 });
    assert.equal(app.screen.children.length, baseline5, 'revert is instant — no modal opened, unlike a fresh split proposal');
    assert.ok(allRaw().some((s) => s.id === merged.id), 'the merged session itself is untouched by reverting its split');

    // Shift+M on the merged session reverts the merge — same
    // explicit-navigation reasoning as above, not an assumed cursor position.
    for (let i = 0; i < 10 && api.row?.id !== merged.id; i++) await sendKeys(input, ['down'], 20);
    assert.equal(api.row?.id, merged.id, 'navigated the cursor onto the merged session');
    sendKey(input, 'M');
    await waitFor(() => !allRaw().some((s) => s.id === merged.id), { timeoutMs: 2000 });
    const restored = allRaw().filter((s) => merged.mergedFrom.includes(s.id));
    assert.equal(restored.length, 2, 'both originals restored after unmerge');
    for (const s of restored) assert.equal(s.supersededBy.length, 0, 'originals are no longer marked as superseded');
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

test('demo (ko locale): organize + learn produces real Korean content, not just Korean chrome', async () => {
  // index.js's language picker calls setLocale() BEFORE seedMockSessions(),
  // which is what this test mirrors — seedMockSessions()/
  // createTutorialMockProvider() both default their locale to i18n.js's
  // getLocale() (see tutorial-data.js/tutorial-mock-llm.js), so setting it
  // first is what makes the seeded session content, the classification
  // keywords, and the knowledge text all resolve to Korean together,
  // consistently. This test is about the actual demo CONTENT being
  // Korean (session titles/summaries, extracted knowledge) — the
  // surrounding narrator/menu chrome's own bilingual coverage lives in
  // i18n.js and isn't re-tested here.
  setLocale('ko');
  // Earlier tests in this file leave their own demo:true sessions in the
  // shared temp store (cleanup(app) only destroys the screen, not the
  // data) — scope the "every title is Korean" check to just the sessions
  // THIS test seeds, not whatever English-locale leftovers preceded it.
  const beforeIds = new Set(allRaw().map((s) => s.id));
  const { app, input, api } = await mountDemo('cse');
  try {
    sendKey(input, 'right');
    await new Promise((r) => setTimeout(r, 30));
    const seeded = allRaw().filter((s) => !beforeIds.has(s.id));
    assert.equal(seeded.length, 5, 'cse persona seeds 5 sessions');
    assert.ok(
      seeded.every((s) => /[가-힣]/.test(s.extracted.title)),
      'every seeded session title must be Korean when locale is ko',
    );

    const baseline = app.screen.children.length;
    sendKey(input, 'o');
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 3000 });
    const onprem = findByKeyword(allRaw(), /온프레미스/);
    assert.equal(onprem.length, 3, 'all 3 onprem-connectivity sessions found via their Korean summary');
    for (const s of onprem) assert.equal(s.suggestedFolder, 'cases/onprem-connectivity');

    sendKey(input, 'enter'); // apply placements
    await waitFor(() => app.screen.children.length === baseline, { timeoutMs: 2000 });

    sendKey(input, 'left');
    await sendKeys(input, ['down', 'down', 'down'], 30);
    await waitFor(() => api.state.folder === 'cases/onprem-connectivity', { timeoutMs: 1000 });
    sendKey(input, 'enter');
    await new Promise((r) => setTimeout(r, 30));

    const baseline2 = app.screen.children.length;
    sendKey(input, 'w');
    await waitFor(() => app.screen.children.length > baseline2, { timeoutMs: 3000 });
    sendKey(input, 'enter');
    await waitFor(() => app.screen.children.length === baseline2, { timeoutMs: 2000 });
    const knowledge = readFileSync(join(TREE_DIR, 'cases', 'onprem-connectivity', 'KNOWLEDGE.md'), 'utf8');
    assert.match(knowledge, /온프레미스/);
    assert.ok(/[가-힣]/.test(knowledge), 'saved KNOWLEDGE.md must actually contain Korean text');
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

test('demo: the narrator box stays visible (in front) once a real modal opens on top of it', async () => {
  // Regression test: the narrator's box (tutorial.js) is created once, at
  // tutorial start, and is bottom-anchored/full-width. Every real widget a
  // later step opens (multiSelectList, confirmText, textView's context
  // viewer, merge/split's review modals) gets parented to app.screen AFTER
  // it, so it draws ON TOP wherever the two overlap — textView() alone is
  // 80% height/centered, tall enough to reach into that same bottom strip.
  // Whichever step's own "what to press next" guidance was showing there
  // became unreadable, hidden under the newer widget. Fixed via
  // render()'s own box.setFront() call on every step settle.
  const { app, input } = await mountDemo();
  try {
    const settle = () => new Promise((r) => setTimeout(r, 320));
    let doneArg;
    startTutorial(app, (completed) => (doneArg = completed), 'swe', { sessionsPreSeeded: true });

    sendKey(input, 'enter');
    await settle();
    // Palette intro (new steps 2/3): `.` opens the action menu, Escape closes.
    let baseline = app.screen.children.length;
    sendKey(input, '.');
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 2000 });
    await settle();
    sendKey(input, 'escape');
    await waitFor(() => app.screen.children.length === baseline, { timeoutMs: 2000 });
    await settle();
    baseline = app.screen.children.length;
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

    // Step 7: press c to open the real context viewer (textView(), 80%
    // height/centered — tall enough to overlap the bottom-anchored
    // narrator box).
    baseline = app.screen.children.length;
    sendKey(input, 'c');
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 1000 });
    await settle(); // narrator's own poll catches up, settles onto step 8, calls render()

    const narratorBox = app.screen.children.find((c) => c._label && /Step \d+\/\d+/.test(c._label.content || ''));
    assert.ok(narratorBox, 'narrator box is still on screen');
    assert.equal(
      app.screen.children.indexOf(narratorBox),
      app.screen.children.length - 1,
      'narrator box is last in app.screen.children (front-most, drawn on top of the context viewer)',
    );

    sendKey(input, 'escape'); // close the context viewer, tutorial continues
    await waitFor(() => app.screen.children.length === baseline, { timeoutMs: 1000 });
    void doneArg;
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
    }, 'swe', { sessionsPreSeeded: true });
    // The opening step — q here is an early exit, not a completed run.
    sendKey(input, 'q');
    await waitFor(() => doneArg !== undefined, { timeoutMs: 1000 });
    assert.equal(doneArg, false, 'q on an early step is not a "completed" run — no demo→real handoff');
    assert.equal(allRaw().filter((s) => s.demo).length, 0, 'endTutorial() cleanup ran');
  } finally {
    cleanup(app);
  }
});

test('demo: startTutorial() sets MYCELIUM_DEMO_MODE for its own lifetime and restores whatever was there before', async () => {
  // Guards a real scenario, not just an implementation detail: first-run
  // onboarding runs startTutorial() in the SAME process as the rest of the
  // real ~/.mycelium CLI, with nothing else to set this env var ahead of
  // time (unlike `mycelium demo`, which gets it from cli.js's own spawned
  // child process env) — so if startTutorial() didn't toggle it itself, a
  // real first-run press of `s` would call a real, unguarded scan().
  //
  // Explicitly cleared (not asserted-clean) before starting: this file's
  // tests share one process, and an earlier test's own startTutorial() run
  // that never reached finish() would otherwise leave this env var already
  // set — harmless to those other tests either way, but it would make this
  // one's own "started unset, ends unset" claim meaningless. The outer
  // ambient value (whatever it was) is restored in `finally` regardless.
  const outerValue = process.env.MYCELIUM_DEMO_MODE;
  delete process.env.MYCELIUM_DEMO_MODE;
  const { app, input } = await mountDemo();
  try {
    let doneArg;
    startTutorial(app, (completed) => (doneArg = completed), 'swe', { sessionsPreSeeded: true });
    assert.equal(process.env.MYCELIUM_DEMO_MODE, '1', 'set for the tutorial\'s duration, even outside mycelium demo\'s own child process');
    sendKey(input, 'q');
    await waitFor(() => doneArg !== undefined, { timeoutMs: 1000 });
    assert.equal(process.env.MYCELIUM_DEMO_MODE, undefined, 'restored to unset once the tutorial ends, not left on for the rest of the real session');
  } finally {
    if (outerValue === undefined) delete process.env.MYCELIUM_DEMO_MODE;
    else process.env.MYCELIUM_DEMO_MODE = outerValue;
    cleanup(app);
  }
});

test('demo: startTutorial() leaves a pre-existing MYCELIUM_DEMO_MODE alone after finishing (mycelium demo\'s own child-process case)', async () => {
  const outerValue = process.env.MYCELIUM_DEMO_MODE;
  process.env.MYCELIUM_DEMO_MODE = '1'; // simulates cli.js's demo command's own child-process env
  const { app, input } = await mountDemo();
  try {
    let doneArg;
    startTutorial(app, (completed) => (doneArg = completed), 'swe', { sessionsPreSeeded: true });
    sendKey(input, 'q');
    await waitFor(() => doneArg !== undefined, { timeoutMs: 1000 });
    assert.equal(process.env.MYCELIUM_DEMO_MODE, '1', 'still \'1\' after finish() — restored to its PRIOR value, not force-deleted');
  } finally {
    if (outerValue === undefined) delete process.env.MYCELIUM_DEMO_MODE;
    else process.env.MYCELIUM_DEMO_MODE = outerValue;
    cleanup(app);
  }
});

test('demo: Escape does not abort the tutorial when no modal is open', async () => {
  const { app, input } = await mountDemo();
  try {
    let doneArg = 'not called';
    startTutorial(app, (completed) => {
      doneArg = completed;
    }, 'swe', { sessionsPreSeeded: true });
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
    }, 'swe', { sessionsPreSeeded: true });
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
    sendKey(input, 'enter'); // the opening step's own real advance — also the real drillIntoSessions() (see tutorial.js)
    await settle();
    // Palette intro (new steps 2/3): `.` opens the action menu, Escape closes.
    let baseline = app.screen.children.length;
    sendKey(input, '.');
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 2000 });
    await settle();
    sendKey(input, 'escape');
    await waitFor(() => app.screen.children.length === baseline, { timeoutMs: 2000 });
    await settle();
    baseline = app.screen.children.length;
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
    // Steps 9/10 — k: knowledge review (mirrors o's own two-step shape —
    // see tutorial.js). Nothing was pre-queued, so this computes fresh for
    // today via the mocked LLM before the review modal opens.
    baseline = app.screen.children.length;
    sendKey(input, 'k');
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 3000 });
    await settle();
    sendKey(input, 'enter'); // defaultAll:true
    await waitFor(() => app.screen.children.length === baseline, { timeoutMs: 2000 });
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

test('resetToRoot() while still on the Calendar tab returns to Sessions, not stuck on Calendar', async () => {
  // A real bug: index.js's onDone callback for the first-run onboarding
  // tutorial calls api.resetToRoot() (not a second app.show()/mount() — see
  // that method's own comment for why) to drop back into the real cockpit.
  // If the tutorial finished while the human was still on the Calendar tab
  // (`v`, never toggled back before the last step's `q`), the old
  // resetToRoot() only touched Sessions' own state: calTab stayed active
  // and its boxes stayed visible, but foldersBox.focus() yanked blessed's
  // real keyboard focus onto the still-hidden Sessions panel underneath —
  // every keypress landed on an invisible widget, reading as "stuck on
  // Calendar AND nothing responds to Enter/Escape" (the same root cause,
  // not two separate bugs).
  const { app, input, api } = await mountDemo();
  try {
    sendKey(input, 'v');
    await new Promise((r) => setTimeout(r, 50));
    const byLabel = (re) => app.body.children.find((c) => re.test(c._label?.content || ''));
    assert.equal(byLabel(/Calendar/)?.hidden, false, 'sanity: Calendar grid is actually showing before the reset');

    api.resetToRoot();

    assert.equal(byLabel(/Folders/)?.hidden, false, 'Sessions\' Folders panel is visible again');
    assert.equal(byLabel(/Sessions/)?.hidden, false, 'Sessions\' own Sessions panel is visible again');
    assert.equal(byLabel(/Calendar/)?.hidden, true, 'Calendar grid is hidden');
    assert.equal(app.screen.focused, byLabel(/Folders/), 'focus landed back on the now-visible Folders panel, not a hidden widget');
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
    }, 'swe', { sessionsPreSeeded: true });
    const settle = () => new Promise((r) => setTimeout(r, 320));

    // No `enter` here — step 1's own key is skipped entirely.
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
    // Steps 9/10 — k: knowledge review (mirrors o's own two-step shape —
    // see tutorial.js). Nothing was pre-queued, so this computes fresh for
    // today via the mocked LLM before the review modal opens.
    baseline = app.screen.children.length;
    sendKey(input, 'k');
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 3000 });
    await settle();
    sendKey(input, 'enter'); // defaultAll:true
    await waitFor(() => app.screen.children.length === baseline, { timeoutMs: 2000 });
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
  // reach later steps early) itself introduced: 'enter' is several other
  // steps' waitFor too (the opening step itself, plus step3/6/10/14 — all
  // thenWait:'close', see tutorial.js), so scanning forward for ANY future
  // step sharing the pressed key's name let a completely unrelated Enter
  // (e.g. drilling into a row, dismissing something) falsely match one of
  // those later steps. Worse, isModalOpen() is already false whenever
  // nothing happens to be open — so that false-positive match resolved a
  // thenWait:'close' wait instantly (no real modal ever had to close),
  // landing on the step after that with zero corresponding real action:
  // a stray Enter pressed while on the Organize lesson (step index1,
  // waitFor:'o') used to forward-match step3 (index2, waitFor:'enter',
  // thenWait:'close') and, since nothing was open yet, resolve THAT
  // instantly too — jumping the narrator straight to step4 (index3) with
  // neither Organize nor Apply ever having actually happened.
  // `enter`/`left`/`right` are now excluded from the forward scan entirely
  // (see tutorial.js's AMBIGUOUS_KEYS) — only an exact match on the
  // CURRENT step counts for those.
  const { app, input } = await mountDemo();
  try {
    let doneArg;
    startTutorial(app, (completed) => {
      doneArg = completed;
    }, 'swe', { sessionsPreSeeded: true });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(narratorStepIndex(app), 1, 'starts on the opening step');

    // The opening step's own waitFor is Enter — which, on this exact
    // screen, is ALSO sessions.js's real drillIntoSessions() (see
    // tutorial.js), so one press both advances the narrator for real and
    // performs the "step into Sessions" action it describes (a plain
    // no-thenWait step, so this settles synchronously) — landing on the
    // palette-intro lesson (waitFor: `.`).
    sendKey(input, 'enter');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(narratorStepIndex(app), 2, 'the opening step\'s own Enter is a real advance, onto the palette-intro lesson');

    sendKey(input, 'enter');
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(narratorStepIndex(app), 2, "a stray Enter on the palette-intro lesson (waitFor: '.') must not advance it");

    // The stray Enter above was also sessions.js's real listBox.key('enter')
    // — drillIntoDetail — so focus is on the Detail panel now, and `.` is
    // deliberately scoped out of Detail (see openActionMenu()'s state.level
    // early-return). Return to the Sessions panel before pressing `.`, same
    // as a real user would.
    sendKey(input, 'left');
    await new Promise((r) => setTimeout(r, 50));

    // The step's own real key still resolves it normally once the real
    // action menu actually opens. Wait past the narrator's own 250ms
    // pollUntil tick before checking, same as the settle() padding the full
    // walkthrough test uses.
    const baseline = app.screen.children.length;
    sendKey(input, '.');
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 3000 });
    await new Promise((r) => setTimeout(r, 400));
    await waitFor(() => narratorStepIndex(app) === 3, { timeoutMs: 2000 });
    assert.equal(doneArg, undefined, 'tutorial is still running');
  } finally {
    cleanup(app);
  }
});

test('k (queued path): reuses an already-staged knowledge proposal instantly, writes KNOWLEDGE.md and injects AGENTS.md', async () => {
  // Simulates what daemon/cycles.js's independent knowledgeReviewCycle would
  // have already staged overnight — k should reuse it without a fresh LLM
  // call (same "makes it instant when the daemon's been doing the work in
  // the background" reasoning o's own runSmartOrganize() already documents).
  // Deliberately not going through Digest (`d`) at all — the two features
  // are unrelated now; this proves `k` alone is enough.
  const { app, input } = await mountDemo();
  try {
    const realDir = mkdtempSync(join(tmpdir(), 'mycelium-review-'));
    saveRaw({ ...emptyNeutral('review-sess-1', 'claude'), folder: 'review-folder', projectDir: realDir });
    writePendingKnowledgeText('review-folder', '# review-folder — Project Knowledge\n\nSome proposed knowledge text.\n');

    const baseline = app.screen.children.length;
    sendKey(input, 'k');
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 1000 });
    sendKey(input, 'enter'); // defaultAll:true — applies the one pending folder shown
    await waitFor(() => existsSync(join(TREE_DIR, 'review-folder', 'KNOWLEDGE.md')), { timeoutMs: 1000 });

    const knowledge = readFileSync(join(TREE_DIR, 'review-folder', 'KNOWLEDGE.md'), 'utf8');
    assert.match(knowledge, /Some proposed knowledge text/);
    assert.equal(existsSync(join(TREE_DIR, 'review-folder', 'KNOWLEDGE.pending.md')), false, 'pending file cleared after promotion');

    const agentsMd = readFileSync(join(realDir, 'AGENTS.md'), 'utf8');
    assert.match(agentsMd, /Some proposed knowledge text/, 'approval auto-injects into the folder\'s known working directory');
  } finally {
    cleanup(app);
  }
});

test('k: p opens a full preview of the proposed knowledge before approving, not just the one-line label snippet', async () => {
  // Regression test: the checklist label truncates to ~60 chars, nowhere
  // near enough to actually review content bound for a real project's
  // AGENTS.md — p must open the full text (confirmText()'s "see it before
  // it lands on disk" principle, applied per-item here).
  const { app, input } = await mountDemo();
  try {
    for (const p of pendingKnowledgeReviews()) dismissPendingKnowledge(p.folder);
    const longText = `# preview-folder — Project Knowledge\n\n${'A'.repeat(40)} distinctive marker text that is definitely longer than sixty characters and would never fully fit in the checklist's own one-line label.`;
    writePendingKnowledgeText('preview-folder', longText);

    const baseline = app.screen.children.length;
    sendKey(input, 'k');
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 1000 });
    const afterReviewOpen = app.screen.children.length;
    sendKey(input, 'p');
    await waitFor(() => app.screen.children.length > afterReviewOpen, { timeoutMs: 1000 });

    // Nothing approved/written yet — pure preview, no side effect.
    assert.equal(existsSync(join(TREE_DIR, 'preview-folder', 'KNOWLEDGE.md')), false);

    // Close the preview (p again, per its own extraCloseKeys) — the
    // checklist underneath must still be usable afterwards.
    sendKey(input, 'p');
    await waitFor(() => app.screen.children.length === afterReviewOpen, { timeoutMs: 1000 });
    sendKey(input, 'enter'); // defaultAll:true
    await waitFor(() => existsSync(join(TREE_DIR, 'preview-folder', 'KNOWLEDGE.md')), { timeoutMs: 1000 });

    assert.match(readFileSync(join(TREE_DIR, 'preview-folder', 'KNOWLEDGE.md'), 'utf8'), /distinctive marker text/);
  } finally {
    cleanup(app);
  }
});

test('k (fresh path): computes today\'s proposal on the spot when nothing was queued', async () => {
  // k must fall back to computing one itself (proposeKnowledgeRefreshes
  // (today), mocked LLM, real spinner) rather than just notifying "nothing
  // to review".
  const { app, input } = await mountDemo();
  try {
    // mountDemo() → seedMockSessions() itself pre-stages a proposal for the
    // persona's merge-target folder (see tutorial.js) — clear it first so
    // this test genuinely exercises the "nothing queued" branch, not the
    // fast reuse-queued one.
    for (const p of pendingKnowledgeReviews()) dismissPendingKnowledge(p.folder);
    const realDir = mkdtempSync(join(tmpdir(), 'mycelium-review-'));
    const today = new Date().toISOString().slice(0, 10);
    saveRaw({
      ...emptyNeutral('fresh-sess-1', 'claude'),
      folder: 'fresh-folder',
      projectDir: realDir,
      startedAt: `${today}T09:00:00.000Z`,
      extracted: { title: null, tags: [], summary: 'fresh folder activity today', decisions: [], todos: [] },
    });

    const baseline = app.screen.children.length;
    sendKey(input, 'k');
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 3000 });
    sendKey(input, 'enter');
    await waitFor(() => existsSync(join(TREE_DIR, 'fresh-folder', 'KNOWLEDGE.md')), { timeoutMs: 1000 });

    assert.ok(readFileSync(join(TREE_DIR, 'fresh-folder', 'KNOWLEDGE.md'), 'utf8').length > 0);
  } finally {
    cleanup(app);
  }
});

test('k: a folder spanning 2+ real directories asks which ones to inject into, instead of writing to all of them silently', async () => {
  // Regression test: dirsForFolder() returns every directory ANY session in
  // a folder happened to run in — including a one-off session asked from an
  // unrelated repo's terminal, content-classified into a real project
  // folder alongside genuine project sessions. Auto-injecting into all of
  // them (the original behavior) silently wrote AGENTS.md into directories
  // that had nothing to do with the actual project.
  const { app, input } = await mountDemo();
  try {
    for (const p of pendingKnowledgeReviews()) dismissPendingKnowledge(p.folder);
    const realProjectDir = mkdtempSync(join(tmpdir(), 'mycelium-real-project-'));
    const unrelatedDir = mkdtempSync(join(tmpdir(), 'mycelium-unrelated-'));
    writePendingKnowledgeText('ambiguous-folder', '# ambiguous-folder — Project Knowledge\n\nSome proposed knowledge text.\n');
    saveRaw({ ...emptyNeutral('amb-sess-1', 'claude'), folder: 'ambiguous-folder', projectDir: realProjectDir });
    saveRaw({ ...emptyNeutral('amb-sess-2', 'claude'), folder: 'ambiguous-folder', projectDir: unrelatedDir });

    const baseline = app.screen.children.length;
    sendKey(input, 'k');
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 1000 });
    sendKey(input, 'enter'); // defaultAll:true — approves the one folder shown
    // The folder-review modal destroys itself and the directory-checklist
    // modal opens synchronously in the same handler — screen.children.length
    // ends up right back at the same count (one destroyed, one created), so
    // this can't be detected via the count-delta trick other steps use.
    // KNOWLEDGE.md existing is the reliable signal that applyKnowledgeApprovals()
    // actually ran (this is also the core regression check: the two used to
    // be one inseparable step, so KNOWLEDGE.md existing with NEITHER
    // directory injected into yet is what proves the fix).
    await waitFor(() => existsSync(join(TREE_DIR, 'ambiguous-folder', 'KNOWLEDGE.md')), { timeoutMs: 1000 });

    assert.equal(existsSync(join(realProjectDir, 'AGENTS.md')), false);
    assert.equal(existsSync(join(unrelatedDir, 'AGENTS.md')), false);

    // defaultAll:true — a bare Enter here still injects into both (same
    // trust level as before for the common "yes, all of these" case);
    // selectively unchecking one is multiSelectList's own generic
    // Space-to-toggle behavior, already covered where that widget is
    // tested elsewhere (`o`'s own review flow).
    sendKey(input, 'enter');
    await waitFor(() => existsSync(join(realProjectDir, 'AGENTS.md')), { timeoutMs: 1000 });

    assert.match(readFileSync(join(realProjectDir, 'AGENTS.md'), 'utf8'), /Some proposed knowledge text/);
    assert.match(readFileSync(join(unrelatedDir, 'AGENTS.md'), 'utf8'), /Some proposed knowledge text/);
  } finally {
    cleanup(app);
  }
});

test('action menu: `.` opens the palette and Esc closes it cleanly (no input wedge)', async () => {
  const { app, input } = await mountDemo();
  try {
    // `.` is a screenKey (fires regardless of focused panel). Opening a modal
    // adds a child to the screen; Esc must remove it and hand focus back —
    // the main risk of adding any new modal is wedging input if it doesn't
    // close cleanly. Assert real child-count transitions, not rendered text
    // (same approach the organize/knowledge steps above use).
    const baseline = app.screen.children.length;
    sendKey(input, '.');
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 2000 });
    sendKey(input, 'escape');
    await waitFor(() => app.screen.children.length === baseline, { timeoutMs: 2000 });

    // Input still works afterwards: `.` opens the menu again (proves the
    // first open/close didn't leave a dangling focus/listener).
    sendKey(input, '.');
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 2000 });
    sendKey(input, 'escape');
    await waitFor(() => app.screen.children.length === baseline, { timeoutMs: 2000 });
  } finally {
    cleanup(app);
  }
});

test('action menu: FOLDER group lists Scan first, then Organize/Knowledge/New task, in that order', async () => {
  // Scan (`s`) was deliberately left out of the palette when it first
  // shipped (PR #63) — added back in, first in the FOLDER group, so
  // "capture then organize" reads as the natural order top to bottom.
  // doScan is now a named function (was an inline screenKey closure) for
  // the same reason doOrganize/doMerge/doNewAgent already are — the menu
  // entry and the `s` key must never be able to drift apart.
  const { app, input } = await mountDemo();
  try {
    sendKey(input, '.');
    await new Promise((r) => setTimeout(r, 80));
    const menuBox = app.screen.children.find((c) => c.type === 'list' && /want to do/.test(c._label?.content || ''));
    assert.ok(menuBox, 'action menu opened');
    const folderIdx = menuBox.items.findIndex((it) => /FOLDER/.test(it.content));
    assert.ok(folderIdx >= 0, 'FOLDER group header present');
    const folderLabels = menuBox.items.slice(folderIdx + 1).map((it) => it.content);
    assert.equal(folderLabels.length, 4, 'exactly 4 items in the FOLDER group, not one extra/missing');
    assert.match(folderLabels[0], /Scan for new sessions.*\(s\)/, 'Scan is first in the FOLDER group');
    assert.match(folderLabels[1], /Organize session.*\(o\)/);
    assert.match(folderLabels[2], /Generate folder insights.*\(w\)/);
    assert.match(folderLabels[3], /New task with folder context.*\(n\)/);

    const baseline = app.screen.children.length - 1; // -1: the menu itself, about to close
    sendKey(input, 'escape');
    await waitFor(() => app.screen.children.length === baseline, { timeoutMs: 2000 });
  } finally {
    cleanup(app);
  }
});

test('demo: selecting Organize from the `.` action menu advances the narrator too, not just direct `o`', async () => {
  // Regression test for the exact gap this fix closes: tutorial.js's step
  // advancement used to be gated purely on matchesWaitFor()'s exact key
  // identity. Selecting a palette item confirms via Enter — the same key
  // that confirms/closes lots of other dialogs — so the narrator had no way
  // to tell "Enter selected Organize from the menu" apart from "Enter did
  // something unrelated", and stayed stuck on the organize step forever if
  // a human used the menu instead of pressing `o` directly. Now doOrganize()
  // itself fires app.tutorialSignal('organize') past its own guards,
  // regardless of which path called it — see sessions.js's own call site.
  const { app, input } = await mountDemo();
  try {
    const settle = () => new Promise((r) => setTimeout(r, 320));

    // Pre-queue a suggestion directly, same technique test/cli.test.js uses
    // for the same reason: this file's tests share ONE store (useTempHome(),
    // no per-test reset), and a couple of earlier tests in this same file
    // (the "action menu" ones just above) seed mock sessions via mountDemo()
    // but never run a tutorial to completion, so nothing ever cleans them
    // up — by the time THIS test runs, suggestPlacements()'s real
    // (unscoped, whole-store) classification call can land on a mix of
    // leftover sessions the mock classifier wasn't tuned for and return no
    // confident placements at all, closing no modal for this test to catch.
    // Queuing one directly sidesteps the classifier entirely — this test is
    // about the MENU triggering the real doOrganize()/review-modal flow at
    // all, not about classification accuracy (already covered elsewhere).
    const target = allRaw().find((s) => !s.folder);
    assert.ok(target, 'seedMockSessions() left at least one unfiled session to suggest a placement for');
    queueSuggestions([{ id: target.id, folder: 'e2e-menu-test/target', reason: 'pre-queued for this test' }]);

    startTutorial(app, () => {}, 'swe', { sessionsPreSeeded: true });

    // Step 1 (intro) -> step 2 (palette-open) -> step 3 (palette-ack, closes
    // it again) -> step 4 (scan, direct key here — the menu path for THIS
    // step is covered by its own dedicated test below) -> lands on the
    // organize step, same steps every other test walks with direct keys.
    sendKey(input, 'enter');
    await settle();
    let baseline = app.screen.children.length;
    sendKey(input, '.');
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 2000 });
    await settle();
    sendKey(input, 'escape');
    await waitFor(() => app.screen.children.length === baseline, { timeoutMs: 2000 });
    await settle();
    assert.equal(narratorStepIndex(app), 4, 'landed on the scan step via the normal path');
    // startTutorial() itself sets MYCELIUM_DEMO_MODE for the tutorial's
    // whole lifetime (see tutorial.js) — this scan() call is guarded
    // without this test needing to touch the env var itself.
    sendKey(input, 's');
    await waitFor(() => narratorStepIndex(app) === 5, { timeoutMs: 2000 });
    await settle();
    assert.equal(narratorStepIndex(app), 5, 'landed on the organize step after scan');

    // Now trigger the SAME organize step's action through the menu instead
    // of pressing `o` directly.
    baseline = app.screen.children.length;
    sendKey(input, '.');
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 2000 });
    await settle();
    const menuBox = app.screen.children.find((c) => c.type === 'list' && /want to do/.test(c._label?.content || ''));
    assert.ok(menuBox, 'action menu opened');
    const organizeIdx = menuBox.items.findIndex((it) => /Organize session.*\(o\)/.test(it.content));
    assert.ok(organizeIdx >= 0, 'Organize entry present in the menu');
    for (let n = menuBox.selected; n < organizeIdx; n++) sendKey(input, 'down');
    await settle();
    sendKey(input, 'enter'); // selects Organize — runs doOrganize() for real, same as pressing `o`

    // Real effect (same proxy the direct-`o` walkthrough test above uses):
    // the pre-queued placement is what's now showing in the real review
    // modal doOrganize() opened.
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 3000 });
    await settle();
    assert.equal(
      allRaw().find((s) => s.id === target.id)?.suggestedFolder,
      'e2e-menu-test/target',
      'the real organize action ran through the menu path, not just a UI no-op',
    );
    // And the narrator itself actually advanced off the organize step —
    // the actual regression this test guards against.
    assert.equal(narratorStepIndex(app), 6, 'narrator advanced to the apply step via the menu path, not stuck');

    sendKey(input, 'enter'); // apply, close the review modal
    await waitFor(() => app.screen.children.length === baseline, { timeoutMs: 2000 });
  } finally {
    cleanup(app);
  }
});

test('demo: the new Scan step advances via the `.` menu too, and never touches real adapters', async () => {
  // startTutorial() itself sets MYCELIUM_DEMO_MODE for the tutorial's whole
  // lifetime (see tutorial.js), so the real ~/.claude/~/.codex/~/.kiro/
  // opencode.db adapters are guarded off automatically here — no test-side env
  // wrangling needed. This test uses mountDemo(), which pre-seeds via
  // seedMockSessions() (unlike the real product flow — see the dedicated
  // "genuinely empty until Scan" test below), so what it actually guards
  // here is that a demo-triggered scan on an ALREADY-seeded store doesn't
  // double the mock sessions on top (app.tutorialSignal's own guard in
  // tutorial.js).
  const { app, input } = await mountDemo();
  try {
    const settle = () => new Promise((r) => setTimeout(r, 320));
    const before = allRaw().length;
    startTutorial(app, () => {}, 'swe', { sessionsPreSeeded: true });

    sendKey(input, 'enter'); // intro
    await settle();
    let baseline = app.screen.children.length;
    sendKey(input, '.'); // palette-open
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 2000 });
    await settle();
    sendKey(input, 'escape'); // palette-ack, closes it
    await waitFor(() => app.screen.children.length === baseline, { timeoutMs: 2000 });
    await settle();
    assert.equal(narratorStepIndex(app), 4, 'landed on the scan step');

    // Trigger it through the menu instead of pressing `s` directly.
    baseline = app.screen.children.length;
    sendKey(input, '.');
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 2000 });
    await settle();
    const menuBox = app.screen.children.find((c) => c.type === 'list' && /want to do/.test(c._label?.content || ''));
    assert.ok(menuBox, 'action menu opened');
    const scanIdx = menuBox.items.findIndex((it) => /Scan for new sessions.*\(s\)/.test(it.content));
    assert.ok(scanIdx >= 0, 'Scan entry present in the menu');
    for (let n = menuBox.selected; n < scanIdx; n++) sendKey(input, 'down');
    await settle();
    sendKey(input, 'enter'); // selects Scan — runs doScan() for real
    await waitFor(() => app.screen.children.length === baseline, { timeoutMs: 2000 }); // menu itself closes immediately

    // Scan has no review modal — the narrator only advances once doScan()'s
    // own signal fires at genuine completion (see tutorial.js/sessions.js).
    await waitFor(() => narratorStepIndex(app) === 5, { timeoutMs: 3000 });
    assert.equal(allRaw().length, before, 'already-seeded demo sessions are not duplicated by a second demo-triggered scan');
  } finally {
    cleanup(app);
  }
});

test('demo: the Sessions view is genuinely empty until the Scan step, matching the real product flow (not mountDemo()\'s pre-seed)', async () => {
  // Every other test in this file uses mountDemo(), which pre-seeds via
  // seedMockSessions() before the tutorial ever starts — a deliberate
  // shortcut for tests that aren't about the Scan step itself. This one
  // instead mirrors exactly what index.js's real forceTutorial/onboarding
  // branches do: mount the (empty) view, call prepareTutorialProvider() only
  // (LLM mock + knowledge pre-stage, no session rows), then start the
  // tutorial with a real reloadSessions callback — see tutorial.js's
  // app.tutorialSignal for where injectDemoSessions() actually fires.
  //
  // Counting demo sessions from a BASELINE, not asserting an absolute 0: this
  // file shares one store across every test (useTempHome(), no per-test
  // reset — see the "action menu" tests' own comment further up), and a
  // couple of earlier tests mount via mountDemo() but never run a tutorial
  // to completion, leaving their own demo:true sessions behind. This test's
  // own claim is narrower and still fully verified by a diff: THIS run
  // contributes zero new demo sessions until Scan fires, then exactly 6.
  prepareTutorialProvider('swe');
  const { input, output } = createTestApp();
  const app = createApp({ input, output });
  let api;
  await app.show(sessionsView({ onReady: (a) => (api = a) }));
  try {
    const settle = () => new Promise((r) => setTimeout(r, 320));
    const demoCountBefore = allRaw().filter((s) => s.demo).length;

    startTutorial(app, () => {}, 'swe', { reloadSessions: () => api.reloadAll() });

    sendKey(input, 'enter'); // intro
    await settle();
    let baseline = app.screen.children.length;
    sendKey(input, '.'); // palette-open
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 2000 });
    await settle();
    sendKey(input, 'escape'); // palette-ack, closes it
    await waitFor(() => app.screen.children.length === baseline, { timeoutMs: 2000 });
    await settle();
    assert.equal(narratorStepIndex(app), 4, 'landed on the scan step');
    assert.equal(allRaw().filter((s) => s.demo).length, demoCountBefore, 'still nothing captured — the Scan step has not fired yet');
    const listItemsBefore = api.listBox.items.length;

    // startTutorial() above already set MYCELIUM_DEMO_MODE for the
    // tutorial's whole lifetime (see tutorial.js) — this scan() call is
    // guarded without this test needing to touch the env var itself.
    sendKey(input, 's');
    await waitFor(() => narratorStepIndex(app) === 5, { timeoutMs: 2000 });
    await settle();

    assert.equal(
      allRaw().filter((s) => s.demo).length,
      demoCountBefore + 6,
      'pressing s injected the persona\'s full mock session set, not before or partially',
    );
    assert.ok(
      api.listBox.items.length > listItemsBefore,
      'the mounted view actually re-rendered the newly-injected sessions (reloadSessions), not just the raw store',
    );
  } finally {
    cleanup(app);
  }
});

test('demo: a scan signal arriving while the narrator is waiting on a different step still injects the mock sessions', async () => {
  // Regression test for a real race found via review: doScan() reports
  // completion from a setImmediate() callback (see its call site in
  // sessions.js), so app.tutorialSignal('scan') can arrive an event-loop
  // tick after the keypress that triggered it. If the human's very next
  // keypress in that tiny window happens to start ANOTHER step's own wait
  // (e.g. pressing `o` immediately after `s`), `waiting` is already true by
  // the time the scan signal's callback runs — the old code's single
  // `if (done || waiting) return;` at the top of app.tutorialSignal dropped
  // the signal entirely, so injectDemoSessions() never ran and the Sessions
  // view stayed silently empty for the rest of the demo (with the narrator
  // having already moved on, nothing left to prompt a retry).
  //
  // Forced deterministically, not by racing a real timer: calling
  // app.tutorialSignal('organize') directly (no real `o` keypress, no real
  // doOrganize()/classification call at all) still runs the exact same
  // advanceFrom() → pollUntil('open') path a real one would, setting
  // `waiting = true` and scheduling a 250ms poll tick — since no real modal
  // is ever going to open behind it, that poll never resolves on its own,
  // giving a genuinely sustained (not microsecond) `waiting === true`
  // window with zero side effects (no async classification chain left
  // dangling past cleanup()). app.tutorialSignal('scan') immediately after
  // lands inside that window every time, no timing sensitivity at all. `q`
  // at the end both proves the tutorial can still be exited cleanly out of
  // a stuck wait (matches onKeypress's own documented q-from-anywhere
  // behavior) and stops that poll's setTimeout chain via `done`, so nothing
  // is left running past this test.
  //
  // Counting from a BASELINE, not an absolute 0: this file shares one store
  // across every test (useTempHome(), no per-test reset — see the "action
  // menu" tests' own comment further up), and earlier tests that mount a
  // tutorial without driving it to completion leave their own demo:true
  // sessions behind. This test's own claim is narrower and still fully
  // verified by a diff: THIS run contributes zero new demo sessions until
  // the signal fires, then exactly 6.
  prepareTutorialProvider('swe');
  const { input, output } = createTestApp();
  const app = createApp({ input, output });
  let api;
  await app.show(sessionsView({ onReady: (a) => (api = a) }));
  try {
    const settle = () => new Promise((r) => setTimeout(r, 320));
    const demoCountBefore = allRaw().filter((s) => s.demo).length;
    let doneArg;
    startTutorial(app, (completed) => (doneArg = completed), 'swe', { reloadSessions: () => api.reloadAll() });

    sendKey(input, 'enter'); // intro
    await settle();

    app.tutorialSignal('organize'); // forces waiting=true via the real advanceFrom()/pollUntil('open') path, no real modal behind it
    assert.equal(
      allRaw().filter((s) => s.demo).length,
      demoCountBefore,
      'sanity: nothing injected yet',
    );

    app.tutorialSignal('scan'); // simulates doScan()'s deferred signal arriving mid-wait

    assert.equal(
      allRaw().filter((s) => s.demo).length,
      demoCountBefore + 6,
      'injection still happens even though the narrator was waiting on a different step',
    );

    sendKey(input, 'q'); // q works from anywhere, including stuck mid-wait — also stops the dangling poll
    await waitFor(() => doneArg !== undefined, { timeoutMs: 1000 });
  } finally {
    cleanup(app);
  }
});
