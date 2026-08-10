import { createApp } from './app.js';
import { sessionsView } from './views/sessions.js';
import { welcomeModal } from './widgets/viewers.js';
import { menu } from './widgets/pickers.js';
import { seedMockSessions, startTutorial, DEMO_HANDOFF_EXIT_CODE } from './tutorial.js';
import { PERSONAS } from './personas.js';
import { C } from './theme.js';
import { t, getLocale, setLocale } from './i18n.js';
import { pendingSuggestions } from '../organize.js';
import { startTuiRoutine } from '../daemon.js';
import { loadConfig, saveConfig } from '../config.js';
import * as data from './data.js';

// Shown before pickPersona, for both `mycelium demo` and first-run
// onboarding — the very first choice a human makes here, so unlike every
// other picker in this file it can't go through t() (the language isn't
// known yet). Shown bilingually; each label is that language's own native
// name, not a translation. `cb` receives undefined if dismissed with
// Escape; callers default that to 'en'. setLocale() (called by the caller,
// not here) takes effect immediately — every t() call from this point on,
// including pickPersona's own label below, reflects the pick.
function pickLanguage(app, cb) {
  menu(
    app,
    'Choose your language / 언어를 선택하세요',
    [
      { label: 'English', value: 'en' },
      { label: '한국어', value: 'ko' },
    ],
    cb,
    { width: '50%' },
  );
}

// Shown before seeding mock sessions, both for `mycelium demo` and for a
// first-run user who opted into the tour — which persona's storylines
// (personas.js) seedMockSessions()/startTutorial() should use. `cb` receives
// undefined if the picker is dismissed with Escape; callers default that to
// 'swe' rather than leaving the demo in a half-started state. personas.js's
// label/description are `{en, ko}` — resolved here against whatever
// pickLanguage() (called first, by every caller) already set.
function pickPersona(app, cb) {
  const locale = getLocale();
  menu(
    app,
    t('tutorial.personaPromptTitle'),
    PERSONAS.map((p) => ({ label: `${p.label[locale]} — {${C.faint}-fg}${p.description[locale]}{/}`, value: p.id })),
    cb,
    { width: '70%' },
  );
}

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
    // Mount the (empty, pre-seed) sessions view FIRST, then show the
    // persona picker on top of it — so the picker has the real TUI chrome
    // (header/panels/statusbar) behind it instead of a bare screen. Seeding
    // happens after the pick, so `api.reloadAll()` is what makes the
    // already-mounted view pick up the newly-written mock sessions (seeding
    // writes straight to the raw store/index, bypassing this view's own
    // in-memory state).
    let api;
    await app.show(sessionsView({ onReady: (a) => (api = a) }));
    app.render();
    pickLanguage(app, (locale = 'en') => {
      setLocale(locale);
      // Refresh right away, not only once seedMockSessions() below also
      // calls reloadAll() — panel border labels (`sessions.foldersPanelLabel`
      // etc.) are blessed widget construction options, only re-applied when
      // something calls reloadAll()'s updatePanelLabels(); without this call
      // here too, any picker still shown on screen before persona/seeding
      // (there is none in this branch, but see the onboarding branch below
      // for where it matters) would sit next to stale-language chrome.
      api.reloadAll();
      pickPersona(app, async (personaId = 'swe') => {
        seedMockSessions(personaId);
        api.reloadAll();
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
        startTutorial(
          app,
          (completed) => {
            app.quit(completed ? DEMO_HANDOFF_EXIT_CODE : 0);
          },
          personaId,
        );
      });
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
    // Mount the (real, pre-seed) sessions view FIRST, same reasoning as the
    // forceTutorial branch above — every picker shown from here on (language,
    // tour prompt, persona) gets real TUI chrome behind it instead of a bare
    // screen.
    let api;
    await app.show(sessionsView({ onReady: (a) => (api = a) }));
    app.render();
    pickLanguage(app, (locale = 'en') => {
      setLocale(locale);
      // Refresh right away — the tour-prompt menu shown next (and, if the
      // human declines the tour, welcomeModal()'s static overview after
      // that) both sit next to this same chrome, and neither path re-seeds
      // anything, so without this the panel labels/status bar would stay
      // stuck in whatever language was active at mount time, before the
      // human had picked one at all. See sessions.js's updatePanelLabels()/
      // updateStatusBar() for why reloadAll() is what actually refreshes them.
      api.reloadAll();
      menu(
        app,
        t('tutorial.promptTitle'),
        [
          { label: t('tutorial.promptYes'), value: 'yes' },
          { label: t('tutorial.promptNo'), value: 'no' },
        ],
        async (choice) => {
          saveConfig({ ...loadConfig(), onboarded: true });
          if (choice === 'yes') {
            pickPersona(app, (personaId = 'swe') => {
              seedMockSessions(personaId);
              api.reloadAll();
              startTutorial(
                app,
                () => {
                  api.resetToRoot();
                  app.render();
                  notifyPostMount(app);
                },
                personaId,
              );
            });
          } else {
            // Declining the guided tour still gets the short static overview.
            welcomeModal(app, () => notifyPostMount(app));
          }
        },
      );
    });
    return;
  }

  await app.show(sessionsView());
  app.render();
  notifyPostMount(app);
}

if (import.meta.url === `file://${process.argv[1]}`) runTui();
