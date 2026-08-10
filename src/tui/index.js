import { createApp } from './app.js';
import { sessionsView } from './views/sessions.js';
import { welcomeModal } from './widgets/viewers.js';
import { menu } from './widgets/pickers.js';
import { seedMockSessions, startTutorial, DEMO_HANDOFF_EXIT_CODE } from './tutorial.js';
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

export async function runTui({ forceTutorial = false } = {}) {
  if (!process.stdout.isTTY) {
    console.error(t('app.needsTty'));
    process.exit(1);
  }
  const app = createApp();

  // `mycelium demo` (cli.js) — MYCELIUM_HOME already points at a throwaway
  // store by the time this process started, so there's no real data to
  // protect and no onboarded prompt to ask; just seed and go straight in.
  // No background daemon either — a one-shot demo shouldn't be scanning
  // for real agent sessions in the background.
  if (forceTutorial) {
    seedMockSessions();
    await app.show(sessionsView());
    app.render();
    // Once the demo sessions are cleaned up, this isolated ~/.mycelium-demo
    // store is empty — resetToRoot() used to just drop back into that empty
    // view, which reads as "the demo is broken" (0 sessions, no obvious way
    // out except the normal `q` quit). If the presenter went all the way
    // through (completed:true — the final step's own q+confirm, not an
    // early Esc bail), quit THIS process with a sentinel exit code instead;
    // cli.js's demo command is watching for it and hands off straight into
    // a real TUI against the user's actual ~/.mycelium. An early Esc bail
    // (completed:false) just quits plainly — someone who bailed out mid-
    // tour didn't ask to see real data next.
    startTutorial(app, (completed) => {
      app.quit(completed ? DEMO_HANDOFF_EXIT_CODE : 0);
    });
    return;
  }

  // Background upkeep (scan/organize/digest) runs inside this same process
  // for as long as the TUI is open, on the same timers a standalone daemon
  // would use — see daemon.js's startTuiRoutine() for why this replaced an
  // auto-spawned separate process. Stops naturally when the TUI exits.
  startTuiRoutine();
  const cfg = loadConfig();

  // First-ever launch: offer the interactive tutorial before dropping into
  // a screen a brand new user has no context for. Mock sessions (if they
  // say yes) are seeded BEFORE the sessions view ever mounts, so its first
  // real render already shows them — no separate "refresh" hook needed for
  // that part. Ending the tutorial uses the view's own resetToRoot() (not a
  // second app.show()) to drop the by-then-deleted mock rows — see that
  // method's comment for why re-mounting a second time isn't safe here.
  if (!cfg.onboarded) {
    menu(
      app,
      t('tutorial.promptTitle'),
      [
        { label: t('tutorial.promptYes'), value: 'yes' },
        { label: t('tutorial.promptNo'), value: 'no' },
      ],
      async (choice) => {
        saveConfig({ ...loadConfig(), onboarded: true });
        if (choice === 'yes') seedMockSessions();
        let api;
        await app.show(sessionsView({ onReady: (a) => (api = a) }));
        app.render();
        if (choice === 'yes') {
          startTutorial(app, () => {
            api.resetToRoot();
            app.render();
            notifyPostMount(app);
          });
        } else {
          // Declining the guided tour still gets the short static overview.
          welcomeModal(app, () => notifyPostMount(app));
        }
      },
    );
    return;
  }

  await app.show(sessionsView());
  app.render();
  notifyPostMount(app);
}

if (import.meta.url === `file://${process.argv[1]}`) runTui();
