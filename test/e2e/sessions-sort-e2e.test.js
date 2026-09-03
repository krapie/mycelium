import test from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from '../helpers.js';
import { createTestApp, sendKey } from '../tui-helpers.js';

// Coverage for issue #51: a direct sort picker (Shift+T) in the Sessions
// panel, alongside the existing Shift+O blind cycle (left untouched — see
// sessions.js's own comment on why the two entry points are independent).
// Real bytes on the input stream (not synthetic keypress objects) are
// required — see tui-helpers.js's module comment.

useTempHome();

const { createApp } = await import('../../src/tui/app.js');
const { sessionsView } = await import('../../src/tui/views/sessions.js');
const { saveRaw } = await import('../../src/scanner.js');
const { emptyNeutral } = await import('../../src/schema.js');
const { reindex } = await import('../../src/index-db.js');

function cleanup(app) {
  app.screen.destroy();
}

// 3 sessions, deliberately chosen so date order, title order, and agent
// order are all DIFFERENT permutations of each other — with only 3 items,
// an earlier version of this fixture had titles/dates that coincidentally
// aliased (date-desc equalled title A-Z, date-asc equalled title Z-A),
// which could hide a swapped picker-option mapping (e.g. "Oldest first"
// silently wired to title-desc) behind a still-passing assertion. Verified
// by hand that each of the 5 orderings below (title A-Z/Z-A, date asc/desc,
// agent) is a distinct permutation of {Apple, Banana, Cherry}:
//   title A-Z:  Apple, Banana, Cherry
//   title Z-A:  Cherry, Banana, Apple
//   date-asc (oldest first): Apple, Cherry, Banana
//   date-desc (newest first): Banana, Cherry, Apple
//   agent (claude < codex < kiro): Banana, Apple, Cherry
const SPECS = [
  { id: 'a-session', title: 'Apple work', startedAt: '2026-01-01T00:00:00.000Z', source: 'codex' }, // oldest
  { id: 'c-session', title: 'Cherry work', startedAt: '2026-01-02T00:00:00.000Z', source: 'kiro' }, // middle
  { id: 'b-session', title: 'Banana work', startedAt: '2026-01-03T00:00:00.000Z', source: 'claude' }, // newest
];

async function mountWithSortableSessions() {
  for (const s of SPECS) {
    const n = emptyNeutral(s.id, s.source);
    // "work" (not just each title's fruit name) so the search-active test
    // below can query for it — searchableText() (schema.js) indexes the title
    // too now, but keeping the phrase in the turn text keeps this fixture
    // independent of which fields FTS happens to cover.
    n.turns = [{ role: 'user', text: `some work happened, id ${s.id}` }];
    n.startedAt = s.startedAt;
    n.extracted.title = s.title;
    saveRaw(n);
  }
  reindex();

  const { input, output } = createTestApp();
  const app = createApp({ input, output });
  let api;
  await app.show(sessionsView({ onReady: (a) => (api = a) }));
  await new Promise((r) => setTimeout(r, 50));
  sendKey(input, 'right'); // focus onto the Sessions list
  await new Promise((r) => setTimeout(r, 30));

  const listBox = app.body.children.find((c) => c._label && /Sessions/.test(c._label.content) && c.type === 'list');
  return { app, input, api, listBox };
}

function titleOrder(listBox) {
  return listBox.items.map((it) => (it.content.match(/(Apple|Banana|Cherry) work/) || [])[1]).filter(Boolean);
}

async function pickSort(input, app, optionIndex) {
  sendKey(input, 'T'); // Shift+T
  await new Promise((r) => setTimeout(r, 80));
  const pickerBox = app.screen.children.find((c) => c.type === 'list' && /Sort by/.test(c._label?.content || ''));
  assert.ok(pickerBox, 'Shift+T opened the sort picker');
  pickerBox.select(optionIndex);
  sendKey(input, 'enter');
  await new Promise((r) => setTimeout(r, 80));
}

test('Shift+T opens a picker with all 4 sort options, each reorders the list correctly', async () => {
  const { app, input, listBox } = await mountWithSortableSessions();
  try {
    assert.deepEqual(titleOrder(listBox), ['Banana', 'Cherry', 'Apple'], 'initial order is recent (DB-ordered, most recent first)');

    await pickSort(input, app, 1); // Oldest first
    assert.deepEqual(titleOrder(listBox), ['Apple', 'Cherry', 'Banana'], 'date-asc: oldest startedAt first');

    await pickSort(input, app, 2); // Title A-Z
    assert.deepEqual(titleOrder(listBox), ['Apple', 'Banana', 'Cherry'], 'title: alphabetical');

    await pickSort(input, app, 3); // Title Z-A
    assert.deepEqual(titleOrder(listBox), ['Cherry', 'Banana', 'Apple'], 'title-desc: reverse alphabetical');

    await pickSort(input, app, 0); // Newest first
    assert.deepEqual(titleOrder(listBox), ['Banana', 'Cherry', 'Apple'], 'date-desc: back to newest-first (a real comparator, not reused "recent")');
  } finally {
    cleanup(app);
  }
});

test('Shift+T picker: Escape leaves the current sort order untouched', async () => {
  const { app, input, listBox } = await mountWithSortableSessions();
  try {
    await pickSort(input, app, 2); // Title A-Z first, so there's a non-default order to preserve
    assert.deepEqual(titleOrder(listBox), ['Apple', 'Banana', 'Cherry']);

    sendKey(input, 'T');
    await new Promise((r) => setTimeout(r, 80));
    const pickerBox = app.screen.children.find((c) => c.type === 'list' && /Sort by/.test(c._label?.content || ''));
    assert.ok(pickerBox, 'picker opened');
    sendKey(input, 'escape');
    await new Promise((r) => setTimeout(r, 80));

    assert.deepEqual(titleOrder(listBox), ['Apple', 'Banana', 'Cherry'], 'order unchanged after cancelling the picker');
  } finally {
    cleanup(app);
  }
});

test('Shift+O\'s existing blind cycle still works unchanged alongside the new Shift+T picker', async () => {
  const { app, input, api, listBox } = await mountWithSortableSessions();
  try {
    // recent -> title (A-Z) -> agent -> recent, same 3-step cycle as before
    // this feature — checked at every step (both api.state.sortBy and the
    // real resulting order), not just the first transition, so a change
    // that broke the cycle's later steps couldn't slip through unnoticed.
    assert.equal(api.state.sortBy, 'recent', 'starts on recent');

    sendKey(input, 'O'); // Shift+O: recent -> title
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(api.state.sortBy, 'title');
    assert.deepEqual(titleOrder(listBox), ['Apple', 'Banana', 'Cherry'], 'title A-Z');

    sendKey(input, 'O'); // title -> agent
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(api.state.sortBy, 'agent');
    assert.deepEqual(titleOrder(listBox), ['Banana', 'Apple', 'Cherry'], 'agent: claude < codex < kiro');

    sendKey(input, 'O'); // agent -> back to recent
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(api.state.sortBy, 'recent');
    assert.deepEqual(titleOrder(listBox), ['Banana', 'Cherry', 'Apple'], 'back to recent (DB-ordered, most recent first)');
  } finally {
    cleanup(app);
  }
});

test('Shift+T "Newest first" means real date order even with a search active, unlike Shift+O\'s "recent"', async () => {
  // Regression test: data.sessions() returns FTS relevance order (not
  // date order) while a search/query is active (data.js). sortRows()'s
  // 'recent' branch is a bare pass-through of whatever that was — correct
  // for Shift+O, whose cycle has always meant "recent" that way — but the
  // picker's "Newest first" option must mean literal date-desc order every
  // time, search or not, which is exactly why it's wired to a real
  // 'date-desc' comparator instead of reusing 'recent'.
  const { app, input, api, listBox } = await mountWithSortableSessions();
  try {
    api.state.query = 'work'; // matches all 3 fixture titles — a real FTS query, not date-ordered
    api.reloadAll();
    await new Promise((r) => setTimeout(r, 30));

    await pickSort(input, app, 0); // Newest first
    assert.equal(api.state.sortBy, 'date-desc');
    assert.deepEqual(titleOrder(listBox), ['Banana', 'Cherry', 'Apple'], 'still true newest-first date order, not FTS relevance order');
  } finally {
    cleanup(app);
  }
});
