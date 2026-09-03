import test from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers.js';

// render.js's own two functions are pure string formatting, but it statically
// imports data.js -> scanner/index-db/organize -> paths.js, whose HOME
// constant is read at module-load time. So we isolate with useTempHome() +
// a dynamic import, same as every other filesystem-touching test here, even
// though no file actually gets written in these particular cases.
useTempHome();
const { splitSentences, formatSessionDetail } = await import('../src/tui/render.js');
const { emptyNeutral } = await import('../src/schema.js');
const { saveRaw } = await import('../src/scanner.js');
const { createBacklog } = await import('../src/backlog.js');

test('splitSentences() breaks a prose paragraph on sentence boundaries', () => {
  const text = 'First sentence. Second sentence! Third one? Fourth.';
  assert.deepEqual(splitSentences(text), ['First sentence.', 'Second sentence!', 'Third one?', 'Fourth.']);
});

test('splitSentences() drops empty fragments and trims whitespace', () => {
  assert.deepEqual(splitSentences('  Only one sentence.   '), ['Only one sentence.']);
});

test('splitSentences() returns an empty array for empty input', () => {
  assert.deepEqual(splitSentences(''), []);
});

function session(overrides = {}) {
  return { ...emptyNeutral('abcdef12-3456', 'claude'), ...overrides };
}

test('formatSessionDetail() returns [] for a falsy session', () => {
  assert.deepEqual(formatSessionDetail(null), []);
  assert.deepEqual(formatSessionDetail(undefined), []);
});

test('formatSessionDetail() renders title, source, folder, tags, and summary bullets', () => {
  const n = session({
    startedAt: '2026-01-01T10:00:00.000Z',
    endedAt: '2026-01-01T10:05:00.000Z',
    folder: 'work/mycelium',
    extracted: { title: 'Fix the scanner', tags: ['bug', 'scanner'], summary: 'Found the bug. Fixed it.', decisions: ['Use useTempHome()'], todos: ['Write more tests'] },
  });
  const lines = formatSessionDetail(n).join('\n');
  assert.match(lines, /Fix the scanner/);
  assert.match(lines, /claude/);
  assert.match(lines, /work\/mycelium/);
  assert.match(lines, /#bug/);
  assert.match(lines, /#scanner/);
  assert.match(lines, /Summary/);
  assert.match(lines, /- Found the bug\./);
  assert.match(lines, /- Fixed it\./);
  assert.match(lines, /Decisions/);
  assert.match(lines, /- Use useTempHome\(\)/);
  assert.match(lines, /Action Items/);
  assert.match(lines, /- Write more tests/);
});

test('formatSessionDetail() shows the session\'s own id in full, not truncated', () => {
  // Issue #57: the Sessions list row used to show a truncated #<8-char>
  // badge instead — removed from the list, moved here, in full (not
  // sliced to 8 chars like the list badge or continuation-link labels
  // below were) since that's the whole point: CLI commands like
  // `mycelium resume <id>` need the real thing, not a prefix.
  const fullId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const n = session({ id: fullId });
  const lines = formatSessionDetail(n).join('\n');
  assert.match(lines, new RegExp(fullId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('formatSessionDetail() shows "(no summary yet)" + first user turn when summary is missing', () => {
  const n = session({
    turns: [
      { role: 'user', text: 'help me fix this bug please' },
      { role: 'assistant', text: 'sure, looking into it' },
    ],
  });
  const lines = formatSessionDetail(n).join('\n');
  assert.match(lines, /no summary yet/);
  assert.match(lines, /First request:/);
  assert.match(lines, /help me fix this bug please/);
});

test('formatSessionDetail() only shows the end-time span when start and end fall on different days', () => {
  const sameDay = session({ startedAt: '2026-01-01T10:00:00.000Z', endedAt: '2026-01-01T10:05:00.000Z' });
  const sameDayLines = formatSessionDetail(sameDay).join('\n');
  assert.doesNotMatch(sameDayLines, /last active/);

  const spansDays = session({ startedAt: '2026-01-01T10:00:00.000Z', endedAt: '2026-01-03T09:00:00.000Z' });
  const spanLines = formatSessionDetail(spansDays).join('\n');
  assert.match(spanLines, /last active/);
  assert.match(spanLines, /2026-01-01 10:00/);
  assert.match(spanLines, /2026-01-03 09:00/);
});

test('formatSessionDetail() falls back to the "New" badge when folder is unset', () => {
  const n = session({ folder: null, startedAt: '2026-01-01T10:00:00.000Z' });
  const lines = formatSessionDetail(n).join('\n');
  assert.match(lines, /New/);
});

test('formatSessionDetail() renders merge/split lineage links using "?" when the referenced session is not in the store', () => {
  const n = session({
    mergedFrom: ['11111111-aaaa', '22222222-bbbb'],
    splitFrom: '33333333-cccc',
    supersededBy: ['44444444-dddd'],
    splitInto: ['55555555-eeee'],
  });
  const lines = formatSessionDetail(n).join('\n');
  assert.match(lines, /merged from 2/i);
  assert.match(lines, /\? #11111111/);
  assert.match(lines, /split from/i);
  assert.match(lines, /\? #33333333/);
  assert.match(lines, /superseded by/i);
  assert.match(lines, /split into 1/i);
});

// Regression: the continuation links printed the parent's raw `source`, so a
// session started from a backlog item (which has none) rendered as
// "이어받음: null #1234abcd". Every lineage reference goes through the same
// refLabel() now.
test('formatSessionDetail() names a backlog parent as a backlog, never as "null"', () => {
  const item = createBacklog({ title: 'queued work', description: 'notes' }).session;
  const child = { ...emptyNeutral('render-child', 'claude'), continuationOf: item.id };
  saveRaw(child);

  const text = formatSessionDetail(child).join('\n');
  assert.match(text, new RegExp(`backlog #${item.id.slice(0, 8)}`));
  assert.doesNotMatch(text, /null/);

  // ...and the other direction, on the item's own detail.
  const parentText = formatSessionDetail({ ...item, continuedTo: ['render-child'] }).join('\n');
  assert.match(parentText, /claude #render-c/);
  assert.doesNotMatch(parentText, /null/);
});
