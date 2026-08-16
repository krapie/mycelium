import test from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from '../helpers.js';
import { createTestApp } from '../tui-helpers.js';

// Covers app.js's startSpinner()/stop() reference-counting on the single
// shared `toast` widget — a real bug found in production: two overlapping
// startSpinner() calls (e.g. a user's merge/split auto-summarize racing the
// background daemon's own periodic scan/tag cycle, both LLM-bound) used to
// mean whichever one called stop() FIRST hid the toast unconditionally,
// even while the other was still genuinely running — read as "the modal
// closed early" with the real result landing later, invisibly. Same plain
// createApp() + fake streams harness as onboarding-e2e.test.js — no
// daemon, no tutorial narrator needed, since this only exercises app.js's
// own widget directly.

useTempHome();

const { createApp } = await import('../../src/tui/app.js');

function cleanup(app) {
  app.screen.destroy();
}

function toastVisible(app) {
  const toast = app.screen.children.find((c) => c.type === 'message');
  return toast && !toast.hidden;
}

test('startSpinner().stop() does not hide the shared toast while another spinner is still active', async () => {
  const { input, output } = createTestApp();
  const app = createApp({ input, output });
  try {
    const first = app.startSpinner('First operation…');
    assert.equal(toastVisible(app), true, 'toast shows once something is busy');
    const second = app.startSpinner('Second operation…');
    assert.equal(app.isBusy(), true);

    first.stop();
    assert.equal(toastVisible(app), true, 'still visible — the second spinner is still in flight');
    assert.equal(app.isBusy(), true, 'isBusy() still true — one real operation remains');

    second.stop();
    assert.equal(toastVisible(app), false, 'hidden once NOTHING is busy anymore');
    assert.equal(app.isBusy(), false);
  } finally {
    cleanup(app);
  }
});

test('startSpinner().stop() still hides the toast in the common single-spinner case', async () => {
  const { input, output } = createTestApp();
  const app = createApp({ input, output });
  try {
    const spin = app.startSpinner('Solo operation…');
    assert.equal(toastVisible(app), true);
    spin.stop();
    assert.equal(toastVisible(app), false);
    assert.equal(app.isBusy(), false);
  } finally {
    cleanup(app);
  }
});

test('startSpinner() and startProgressBar() share one busyWidgets count — whichever stop() reaches 0 hides the toast', async () => {
  // toast (spinner) and progressBox (progress bar) are separate widgets,
  // but both increment/decrement the SAME shared busyWidgets counter (see
  // isBusy()'s own comment) and both call the same hideToastIfIdle()
  // helper from their own stop() — so if a progress bar happens to still
  // be active when a spinner's own stop() fires, the toast correctly stays
  // visible until whichever of the two stop()s actually brings the shared
  // count to 0, even if that turns out to be the progress bar's own
  // stop(), not the spinner's. Not reachable through the real UI today —
  // sessions.js's asyncReviewFlowRunning guard already keeps every
  // spinner-using action and the one progress-bar-using action (`o`)
  // mutually exclusive — but this is app.js's own mechanism, tested at its
  // level regardless of what currently gates access to it above.
  const { input, output } = createTestApp();
  const app = createApp({ input, output });
  try {
    const spin = app.startSpinner('Spinner…');
    const bar = app.startProgressBar('Progress…');
    assert.equal(toastVisible(app), true);

    spin.stop();
    assert.equal(toastVisible(app), true, 'toast stays up — the shared counter is still > 0 (progress bar)');
    assert.equal(app.isBusy(), true);

    bar.stop();
    assert.equal(toastVisible(app), false, 'now hidden — the progress bar\'s own stop() was the one to reach 0');
    assert.equal(app.isBusy(), false);
  } finally {
    cleanup(app);
  }
});
