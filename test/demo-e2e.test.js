import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers.js';
import { createTestApp, sendKey, sendKeys, waitFor } from './tui-helpers.js';

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

const { allRaw } = await import('../src/scanner.js');
const { TREE_DIR } = await import('../src/paths.js');
const { createApp } = await import('../src/tui/app.js');
const { sessionsView } = await import('../src/tui/views/sessions.js');
const { seedMockSessions, startTutorial } = await import('../src/tui/tutorial.js');

function findByKeyword(sessions, re) {
  return sessions.filter((s) => re.test(s.extracted.summary || ''));
}

// Mounts the real sessions view against a fake terminal, seeded with the
// real 6-session demo dataset. Returns { app, input, api } — api is
// sessionsView's own exposed state/handles (see sessions.js's
// this._api / opts.onReady), used here only to read state.folder for
// assertions/navigation checks, never to shortcut past real keypresses.
async function mountDemo() {
  seedMockSessions();
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
    // unfiled demo sessions. Wait for the real side effect (suggestedFolder
    // queued on every candidate) rather than a fixed delay.
    const baseline = app.screen.children.length;
    sendKey(input, 'o');
    await waitFor(() => app.screen.children.length > baseline, { timeoutMs: 3000 });

    const payments = findByKeyword(allRaw(), /pg-pool|connection-?pool|payment/i);
    const loginUi = findByKeyword(allRaw(), /login-card|ios safari|responsive/i);
    const salesPipeline = findByKeyword(allRaw(), /airflow|sales|pandas/i);
    assert.equal(payments.length, 2, 'both payment sessions found');
    for (const s of payments) assert.equal(s.suggestedFolder, 'backend/payments');
    for (const s of loginUi) assert.equal(s.suggestedFolder, 'frontend/login-ui');
    for (const s of salesPipeline) assert.equal(s.suggestedFolder, 'data/sales-pipeline');

    // Step 3 — Enter: apply the (all-checked-by-default) placements.
    sendKey(input, 'enter');
    await waitFor(() => app.screen.children.length === baseline, { timeoutMs: 2000 });
    assert.equal(allRaw().find((s) => s.id === payments[0].id).folder, 'backend/payments', 'placement actually applied, not just suggested');

    // Step 4 — ←: back to Folders (real fix for the panel-focus bug —
    // organize's apply flow leaves focus on Sessions, so this is required
    // before folder-list navigation means anything). Then walk down to
    // backend/payments (Root → New → backend → payments) and open it.
    sendKey(input, 'left');
    await sendKeys(input, ['down', 'down', 'down'], 30);
    await waitFor(() => api.state.folder === 'backend/payments', { timeoutMs: 1000 });
    sendKey(input, 'enter');
    await new Promise((r) => setTimeout(r, 30));

    // Step 5/6 — w: real buildKnowledgeText() call (mocked), then Enter to
    // save. Assert the REAL file on disk, not just the in-memory preview.
    const baseline2 = app.screen.children.length;
    sendKey(input, 'w');
    await waitFor(() => app.screen.children.length > baseline2, { timeoutMs: 3000 });
    sendKey(input, 'enter');
    await waitFor(() => app.screen.children.length === baseline2, { timeoutMs: 2000 });
    const knowledge = readFileSync(join(TREE_DIR, 'backend', 'payments', 'KNOWLEDGE.md'), 'utf8');
    assert.match(knowledge, /Payments backend/);
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

    // Step 9/10 — select both payment sessions, Shift+M merge. No LLM call
    // — mergeSessions() is synchronous, so no poll needed, just a settle.
    // A literal uppercase char over the raw byte stream arrives as
    // key.name:'m' + key.shift:true, exactly like a real terminal — that's
    // what listBox.key('S-m', ...) actually matches internally.
    sendKey(input, 'space');
    sendKey(input, 'down');
    sendKey(input, 'space');
    sendKey(input, 'M');
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(app.screen.children.length > baseline3, 'Shift+M opened the merge title prompt');
    sendKey(input, 'enter'); // accept default title
    await waitFor(() => allRaw().some((s) => s.mergedFrom?.length === 2), { timeoutMs: 2000 });
    const merged = allRaw().find((s) => s.mergedFrom?.length === 2);
    assert.equal(merged.folder, 'backend/payments', 'merge kept the shared folder instead of landing unfiled — regression test');

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
    for (const p of pieces) assert.equal(p.folder, 'backend/payments');
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
    await sendKeys(input, ['down', 'down', 'down'], 30);
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
