import { createApp } from './app.js';
import { sessionsView } from './views/sessions.js';
import { welcomeModal } from './widgets/viewers.js';
import { t } from './i18n.js';
import { pendingSuggestions } from '../organize.js';
import { startTuiRoutine } from '../daemon.js';
import { loadConfig, saveConfig } from '../config.js';
import * as data from './data.js';

// Toast(s) that make sense once the view is up and settled — pending
// smart-organize suggestions first (something already computed, waiting on
// a decision), otherwise the unfiled-backlog nudge for a store that hasn't
// been organized at all yet (most likely a new user's first real session).
function notifyPostMount(app) {
  const pending = pendingSuggestions().length;
  if (pending) return app.notify(t('smart.pendingOnOpen', pending), 5);
  const unfiled = data.sessions({ folder: null }).length;
  if (!data.folders().list.length && unfiled >= 3) {
    app.notify(t('sessions.unfiledHint', unfiled), 8);
  }
}

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

  // First-ever launch: a short one-time tour instead of dropping straight
  // into a screen a brand new user has no context for. Toasts wait until
  // it's dismissed — a toast opened in the same tick as this modal would
  // visibly overlap it (both are centered blessed overlays; see
  // launch.js's launchAgent()/sessions.js's `o` handler for the same bug
  // fixed twice already this way).
  const cfg = loadConfig();
  if (!cfg.onboarded) {
    welcomeModal(app, () => {
      saveConfig({ ...loadConfig(), onboarded: true });
      notifyPostMount(app);
    });
    return;
  }
  notifyPostMount(app);
}

if (import.meta.url === `file://${process.argv[1]}`) runTui();
