import test from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from '../helpers.js';
import { createTestApp, sendKey } from '../tui-helpers.js';

// Covers the two new real-usage-only (not demo/tutorial) onboarding pieces
// added alongside the tutorial's intro step + recap: app.js's
// startProgressBar() and widgets/viewers.js's firstScanModal(). Both are
// plain widgets driven directly against a real createApp() + fake streams
// (same harness as demo-e2e.test.js, see tui-helpers.js's module comment
// for why real bytes are needed for key-driven assertions) — no daemon,
// no tutorial narrator, no persona seeding needed, since neither piece
// depends on any of that. index.js's own threshold/gating logic that
// decides WHEN to show firstScanModal vs. the plain toast is intentionally
// left to manual tmux verification (see AGENTS.md's Tests section: general
// TUI polish beyond the tutorial/demo flow has no automated coverage) —
// runTui() itself starts a real background daemon routine and isn't a
// clean fit for this harness.

useTempHome();

const { createApp } = await import('../../src/tui/app.js');
const { firstScanModal } = await import('../../src/tui/widgets/viewers.js');

function cleanup(app) {
  app.screen.destroy();
}

test('app.startProgressBar(): a real filling progress bar, not just animated text', async () => {
  const { input, output } = createTestApp();
  const app = createApp({ input, output });
  try {
    const bar = app.startProgressBar('Testing progress');

    const findBox = () =>
      app.screen.children.find((c) => c.type === 'box' && !c.hidden && String(c.content || '').includes('Testing progress'));
    let box = findBox();
    assert.ok(box, 'the progress box is shown with the given label');
    const pb = box.children.find((c) => c.type === 'progress-bar');
    assert.ok(pb, 'has a real blessed progress-bar child, not just spinner text');
    assert.equal(pb.filled, 0, 'starts empty');

    bar.update(3, 10);
    assert.equal(pb.filled, 30, 'update(current, total) sets a real fill percentage');
    box = findBox();
    assert.ok(box.content.includes('(3/10)'), 'update() also reflects the counts in the label text');

    bar.update(10, 10);
    assert.equal(pb.filled, 100, 'reaches 100% once current === total');

    bar.stop();
    assert.equal(box.hidden, true, 'stop() hides the box (and its progress-bar child with it)');
  } finally {
    cleanup(app);
  }
});

test('firstScanModal(): shows the count, dismisses on Enter, calls onDismiss', async () => {
  const { input, output } = createTestApp();
  const app = createApp({ input, output });
  try {
    let dismissed = false;
    const baseline = app.screen.children.length;
    const box = firstScanModal(app, 42, () => (dismissed = true));

    assert.equal(app.screen.children.length, baseline + 1, 'opens as a real new modal, not a reused toast');
    assert.ok(box.content.includes('42'), 'body mentions the actual unfiled count');

    sendKey(input, 'enter');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(app.screen.children.length, baseline, 'closes back down on Enter');
    assert.equal(dismissed, true, 'onDismiss fires so the caller can persist config.firstScanModalShown');
  } finally {
    cleanup(app);
  }
});

test('firstScanModal(): Escape also dismisses it', async () => {
  const { input, output } = createTestApp();
  const app = createApp({ input, output });
  try {
    let dismissed = false;
    firstScanModal(app, 99, () => (dismissed = true));
    sendKey(input, 'escape');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(dismissed, true);
  } finally {
    cleanup(app);
  }
});
