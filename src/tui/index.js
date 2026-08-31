import { createApp } from './app.js';
import { sessionsView } from './views/sessions.js';
import { welcomeModal, firstScanModal } from './widgets/viewers.js';
import { menu } from './widgets/pickers.js';
import { prepareTutorialProvider, startTutorial, DEMO_HANDOFF_EXIT_CODE } from './tutorial.js';
import { PERSONAS } from './personas.js';
import { C } from './theme.js';
import { t, getLocale, setLocale } from './i18n.js';
import { pendingSuggestions } from '../organize.js';
import { pendingKnowledgeReviews } from '../insight.js';
import { startTuiRoutine } from '../daemon.js';
import { loadConfig, saveConfig } from '../config.js';
import * as data from './data.js';

// Shown before pickPersona — the first choice a human makes, so unlike
// every other picker here it can't go through t() (language isn't known
// yet). Shown bilingually. `cb` receives undefined if dismissed with Escape.
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

// Shown before the tutorial starts, both for `mycelium demo` and for a
// first-run user who opted into the tour — which persona's storylines
// (personas.js) prepareTutorialProvider()/startTutorial() should use. `cb` receives
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

// Below this many unfiled sessions, the lightweight toast is enough —
// above it, a real first scan can mean minutes of classification once `o`
// is pressed, which deserves the proper modal (firstScanModal) instead. See
// notifyPostMount() below.
const FIRST_SCAN_MODAL_THRESHOLD = 20;

// Toast(s) that make sense once the view is up and settled — pending
// smart-organize suggestions first (something already computed, waiting on
// a decision), otherwise the unfiled-backlog nudge for a store that hasn't
// been organized at all yet (most likely a new user's first real session).
function notifyPostMount(app) {
  const pending = pendingSuggestions().length;
  if (pending) return app.notify(t('smart.pendingOnOpen', pending), 5);
  // Same tier as the smart-organize toast above: something the daemon's
  // independent knowledgeReviewCycle already computed overnight (see
  // insight.js's proposeKnowledgeRefreshes()), waiting on a human decision.
  // No toast fires the moment it's computed (that cycle itself is silent) —
  // this is the deliberately deferred "you didn't press `k` yet, here's a
  // nudge next time you open Mycelium" surface, not an interrupt at
  // generation time. Unrelated to Digest (`d`) — a separate feature.
  const knowledgePending = pendingKnowledgeReviews().length;
  if (knowledgePending) return app.notify(t('knowledge.pendingOnOpen', knowledgePending), 5);
  const unfiled = data.sessions({ folder: null }).length;
  if (!data.folders().list.length && unfiled >= 3) {
    // A real first-scan-sized backlog: promote to the one-time modal
    // (guidance + "this takes a while, go do something else") instead of
    // the toast — gated on config.json's firstScanModalShown so it only
    // ever shows once, ever, even across restarts. Below the threshold
    // (or once already shown), the original lightweight toast still
    // covers it.
    if (unfiled >= FIRST_SCAN_MODAL_THRESHOLD) {
      const cfg = loadConfig();
      if (!cfg.firstScanModalShown) {
        saveConfig({ ...cfg, firstScanModalShown: true });
        return firstScanModal(app, unfiled);
      }
    }
    app.notify(t('sessions.unfiledHint', unfiled), 8);
  }
}

export async function runTui({ forceTutorial = false } = {}) {
  if (!process.stdout.isTTY) {
    console.error(t('app.needsTty'));
    process.exit(1);
  }
  const app = createApp();

  // Shared by every startTuiRoutine() call site — scanCycle() is
  // fire-and-forget, so notifyPostMount() right after mount can run before
  // the first scan imports anything. A real bug (confirmed via VHS) came
  // from this only being applied to one of the three call sites — the
  // others missed the modal's only fair chance to fire. `getApi` is a
  // closure since each site's `api` is still undefined when this runs.
  const startUpkeepAndRecheck = (getApi) =>
    startTuiRoutine(() => {
      getApi()?.reloadAll();
      notifyPostMount(app);
    });

  // `mycelium demo` (cli.js) — MYCELIUM_HOME already points at a throwaway
  // store by the time this process started, so there's no real data to
  // protect and no onboarded prompt to ask; just seed and go straight in.
  // No background daemon either — a one-shot demo shouldn't be scanning
  // for real agent sessions in the background.
  if (forceTutorial) {
    // Mount the (empty) sessions view FIRST, so the persona picker has real
    // TUI chrome behind it. Genuinely empty is the point: session rows land
    // later, the moment the tutorial's Scan step fires (see tutorial.js).
    let api;
    await app.show(sessionsView({ onReady: (a) => (api = a) }));
    app.render();
    pickLanguage(app, (locale = 'en') => {
      setLocale(locale);
      // Refresh right away — panel border labels (`sessions.foldersPanelLabel`
      // etc.) are blessed widget construction options, only re-applied when
      // something calls reloadAll()'s updatePanelLabels(); without this call
      // here too, any picker still shown on screen before persona pick
      // (there is none in this branch, but see the onboarding branch below
      // for where it matters) would sit next to stale-language chrome.
      api.reloadAll();
      pickPersona(app, async (personaId = 'swe') => {
        prepareTutorialProvider(personaId);
        // A completed run (q on the actual last step) quits with a sentinel
        // exit code instead — cli.js's demo command watches for it and hands
        // off into a real TUI. An early Esc bail just quits plainly.
        startTutorial(
          app,
          (completed) => {
            app.quit(completed ? DEMO_HANDOFF_EXIT_CODE : 0);
          },
          personaId,
          { reloadSessions: () => api.reloadAll() },
        );
      });
    });
    return;
  }

  // Background upkeep (scan/organize/digest) runs inside this process for
  // as long as the TUI is open — see daemon.js's startTuiRoutine().
  // Deliberately NOT called here, before the onboarded check — a real bug
  // (v0.1.0): scanCycle() ran unawaited, concurrently with first-run
  // onboarding, so a real scan could import real history alongside the
  // mock sessions. Fixed by firing these calls only once onboarding concludes.
  const cfg = loadConfig();

  // First-ever launch: offer the interactive tutorial before dropping into
  // a screen a brand new user has no context for. Mock sessions (if they
  // say yes) are seeded BEFORE the sessions view ever mounts, so its first
  // real render already shows them — no separate "refresh" hook needed for
  // that part. Ending the tutorial uses the view's own resetToRoot() (not a
  // second app.show()) to drop the by-then-deleted mock rows — see that
  // method's comment for why re-mounting a second time isn't safe here.
  if (!cfg.onboarded) {
    // Mount the (empty) sessions view FIRST, same reasoning as the
    // forceTutorial branch above — every picker from here gets real TUI
    // chrome behind it. Stays empty even if the human picks the tour.
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
              prepareTutorialProvider(personaId);
              startTutorial(
                app,
                () => {
                  api.resetToRoot();
                  app.render();
                  notifyPostMount(app);
                  // Only now — the mock rows are gone (endTutorial()'s sweep)
                  // and the human is looking at their real (still-empty, not
                  // yet scanned) cockpit, not the tutorial — see this
                  // function's own header comment for why this moved here.
                  // See startUpkeepAndRecheck()'s own comment (top of this
                  // function) for why the re-check callback matters here too,
                  // not just the already-onboarded branch below.
                  startUpkeepAndRecheck(() => api);
                },
                personaId,
                { reloadSessions: () => api.reloadAll() },
              );
            });
          } else {
            // Declining the guided tour still gets the short static overview.
            // Same reasoning as the startTutorial() branch above — this is
            // also a genuinely fresh store's first-ever notifyPostMount().
            welcomeModal(app, () => {
              notifyPostMount(app);
              startUpkeepAndRecheck(() => api);
            });
          }
        },
      );
    });
    return;
  }

  // Already onboarded — safe to start real background upkeep right away.
  // Also the branch a `mycelium demo` handoff always lands on. notifyPostMount()
  // firing twice (here and from the callback) is safe: gated on firstScanModalShown.
  let api;
  // Mount + render BEFORE starting upkeep — scan() is fully synchronous, so
  // scanCycle() blocks the event loop for the duration of a real scan;
  // starting upkeep first left the screen frozen through that block.
  await app.show(sessionsView({ onReady: (a) => (api = a) }));
  app.render();
  startUpkeepAndRecheck(() => api);
  // Belt-and-suspenders: scanCycle()'s onScanned hook usually fires
  // synchronously before this line, making this a no-op, but kept explicit
  // in case that timing coupling ever changes.
  api?.reloadAll();
  notifyPostMount(app);
}

if (import.meta.url === `file://${process.argv[1]}`) runTui();
