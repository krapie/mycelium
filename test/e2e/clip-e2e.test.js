import test from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from '../helpers.js';
import { createTestApp, sendKey, sendKeys, waitFor } from '../tui-helpers.js';

// Coverage for `p` (clip.js): pick turns from a session's conversation and
// pin them. Real bytes on the input stream — see tui-helpers.js.

useTempHome();

const { createApp } = await import('../../src/tui/app.js');
const { sessionsView } = await import('../../src/tui/views/sessions.js');
const { saveRaw } = await import('../../src/scanner.js');
const { emptyNeutral } = await import('../../src/schema.js');
const { mkdir } = await import('../../src/organize.js');
const { listClips } = await import('../../src/clip.js');
const { reindex } = await import('../../src/index-db.js');

test('p pins a contiguous run of picked turns as one clip, with a note, and the detail panel lists it', async () => {
  mkdir('Talks');
  const n = emptyNeutral('clip-e2e-session', 'claude');
  n.folder = 'Talks';
  n.organizedBy = 'human';
  n.turns = [
    { role: 'user', text: 'how should I lay out the prompt?' },
    { role: 'assistant', text: 'Static layers first, per-user text last.' },
    { role: 'user', text: 'and the cache?' },
  ];
  saveRaw(n);
  reindex();

  const { input, output } = createTestApp();
  const app = createApp({ input, output });
  await app.show(sessionsView({}));
  await new Promise((r) => setTimeout(r, 50));
  const foldersBox = app.body.children.find((c) => c.type === 'list' && /Folders|폴더/.test(c._label?.content || ''));
  try {
    await sendKeys(input, Array(foldersBox._keys.indexOf('Talks')).fill('down'), 40);
    sendKey(input, 'enter');
    await new Promise((r) => setTimeout(r, 60));

    sendKey(input, 'p');
    await waitFor(() => app.screen.children.some((c) => c.type === 'list' && /pin which turns/i.test(c._label?.content || '')));
    // Turns 2 and 3 — adjacent, so they should land as ONE clip.
    await sendKeys(input, ['down', 'space', 'down', 'space'], 30);
    sendKey(input, 'enter');
    await waitFor(() => app.screen.children.some((c) => c.type === 'prompt'));
    await new Promise((r) => setTimeout(r, 150)); // see backlog-e2e: prompt's readInput is wired a tick late
    await sendKeys(input, ['k', 'e', 'y'], 15);
    sendKey(input, 'enter');

    await waitFor(() => listClips({ sessionId: 'clip-e2e-session' }).length === 1);
    const [clip] = listClips({ sessionId: 'clip-e2e-session' });
    assert.equal(clip.from, 2);
    assert.equal(clip.to, 3);
    assert.equal(clip.note, 'key');
    assert.equal(clip.turns[0].text, 'Static layers first, per-user text last.');

    const detailBox = app.body.children.find((c) => /Static layers first/.test(c.getContent?.() || '') && c.type !== 'list');
    assert.ok(detailBox, 'the detail panel lists the new clip');
    assert.match(detailBox.getContent(), /Pinned clips \(1\)/);
  } finally {
    app.screen.destroy();
  }
});

// Regression: arrowing to a turn and pressing Enter (no Space) used to pin
// nothing and close silently — the picker only returned checked rows.
test('p then Enter with nothing checked pins the highlighted turn', async () => {
  mkdir('Quick');
  const n = emptyNeutral('clip-e2e-highlight', 'claude');
  n.folder = 'Quick';
  n.organizedBy = 'human';
  n.turns = [
    { role: 'user', text: 'question' },
    { role: 'assistant', text: 'the highlighted answer' },
  ];
  saveRaw(n);
  reindex();

  const { input, output } = createTestApp();
  const app = createApp({ input, output });
  await app.show(sessionsView({}));
  await new Promise((r) => setTimeout(r, 50));
  const foldersBox = app.body.children.find((c) => c.type === 'list' && /Folders|폴더/.test(c._label?.content || ''));
  try {
    await sendKeys(input, Array(foldersBox._keys.indexOf('Quick')).fill('down'), 40);
    sendKey(input, 'enter');
    await new Promise((r) => setTimeout(r, 60));

    sendKey(input, 'p');
    await waitFor(() => app.screen.children.some((c) => c.type === 'list' && /pin which turns/i.test(c._label?.content || '')));
    await sendKeys(input, ['down'], 30);
    sendKey(input, 'enter');
    await waitFor(() => app.screen.children.some((c) => c.type === 'prompt'));
    await new Promise((r) => setTimeout(r, 150));
    sendKey(input, 'enter'); // empty note

    await waitFor(() => listClips({ sessionId: 'clip-e2e-highlight' }).length === 1);
    const [clip] = listClips({ sessionId: 'clip-e2e-highlight' });
    assert.equal(clip.from, 2);
    assert.equal(clip.turns[0].text, 'the highlighted answer');
    assert.equal(clip.note, null);
  } finally {
    app.screen.destroy();
  }
});

test('Backlog and Clips sit right under New; each lists only its own kind, and a clip row opens its full text and jumps to its source', async () => {
  const { createBacklog } = await import('../../src/backlog.js');
  const { createClip } = await import('../../src/clip.js');
  mkdir('Mixed');
  const n = emptyNeutral('clip-e2e-source', 'claude');
  n.folder = 'Mixed';
  n.organizedBy = 'human';
  n.turns = [
    { role: 'user', text: 'q' },
    { role: 'assistant', text: 'a {curly} answer worth keeping' },
  ];
  saveRaw(n);
  createBacklog({ title: 'write it later' });
  createClip({ sessionId: 'clip-e2e-source', from: 2, note: 'keeper' });
  reindex();

  const { input, output } = createTestApp();
  const app = createApp({ input, output });
  let api;
  await app.show(sessionsView({ onReady: (a) => (api = a) }));
  await new Promise((r) => setTimeout(r, 50));
  const foldersBox = app.body.children.find((c) => c.type === 'list' && /Folders|폴더/.test(c._label?.content || ''));
  const listBox = app.body.children.find((c) => c._label && /Sessions/.test(c._label.content) && c.type === 'list');
  const detailBox = app.body.children.find((c) => c._label && /Detail/.test(c._label.content));
  try {
    assert.match(foldersBox.items[2].content, /Backlog \(\d+\)/);
    assert.match(foldersBox.items[3].content, /Clips \(\d+\)/);

    await sendKeys(input, ['down', 'down'], 40); // Root → New → Backlog
    await waitFor(() => api.state.view === 'backlog');
    assert.equal(api.state.folder, undefined, 'a collection browses store-wide, never as a fake folder');
    assert.ok(listBox.items.length > 0 && listBox.items.every((it) => /Backlog|Opened/.test(it.content)), 'only backlog rows');

    sendKey(input, 'down'); // → Clips
    await waitFor(() => api.state.view === 'clips');
    await waitFor(() => listBox.items.some((it) => /keeper/.test(it.content)));
    assert.ok(listBox.items.every((it) => /Clip #/.test(it.content)), 'only clip rows');

    sendKey(input, 'enter'); // into the list
    const idx = listBox.items.findIndex((it) => /keeper/.test(it.content));
    await sendKeys(input, Array(idx).fill('down'), 30);
    sendKey(input, 'enter'); // into detail
    await new Promise((r) => setTimeout(r, 60));
    assert.match(detailBox.getContent(), /a \{curly\} answer worth keeping/, 'full text, braces shown literally');

    sendKey(input, 'enter'); // jump to the source session
    await waitFor(() => api.state.view === 'sessions' && api.state.folder === 'Mixed');
    assert.equal(api.row?.id, 'clip-e2e-source');
  } finally {
    app.screen.destroy();
  }
});
