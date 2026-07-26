import { createApp } from './app.js';
import { sessionsView } from './views/sessions.js';
import { t } from './i18n.js';
import { pendingSuggestions } from '../organize.js';
import { startTuiRoutine } from '../daemon.js';

export async function runTui() {
  if (!process.stdout.isTTY) {
    console.error(t('app.needsTty'));
    process.exit(1);
  }
  // Background upkeep (scan/organize/digest) runs inside this same process
  // for as long as the TUI is open, on the same timers a standalone daemon
  // would use — see daemon.js's startTuiRoutine() for why this replaced an
  // auto-spawned separate process. Stops naturally when the TUI exits.
  startTuiRoutine();
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
