import { createApp } from './app.js';
import { sessionsView } from './views/sessions.js';
import { t } from './i18n.js';
import { pendingSuggestions } from '../organize.js';
import { ensureDaemonRunning } from '../daemon.js';

export async function runTui() {
  if (!process.stdout.isTTY) {
    console.error(t('app.needsTty'));
    process.exit(1);
  }
  // Opening the TUI is "using Mycelium" — that's enough to keep the
  // background upkeep (scan/organize/digest) alive going forward, no
  // separate `mycelium daemon` step to remember. No-ops if one's already
  // running (see ensureDaemonRunning's pidfile check).
  ensureDaemonRunning();
  const app = createApp();
  await app.show(sessionsView());
  app.render();

  // Surfaces smart-organize suggestions the daemon queued while this session
  // was away (see organize.js's smartOrganizeCycle) — no-op if nothing's
  // queued, e.g. the daemon isn't running or there's nothing to suggest yet.
  const n = pendingSuggestions().length;
  if (n) app.notify(t('smart.pendingOnOpen', n), 5);
}

if (import.meta.url === `file://${process.argv[1]}`) runTui();
