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
// Exported so demo/pitch-launch.mjs can reuse this exact logic without
// pulling in runTui()'s unconditional startTuiRoutine() call — see that
// file's own header comment for why.
export function notifyPostMount(app) {
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

  // Shared by every startTuiRoutine() call site below (the accepted-tour,
  // declined-tour, and already-onboarded branches) — startTuiRoutine()'s own
  // scanCycle() is fire-and-forget, so whichever notifyPostMount() call ran
  // right after mount can easily run before that first scan has imported
  // anything: a genuinely fresh store reads 0 sessions and the first-scan-
  // modal's threshold check never clears. A real bug (confirmed via VHS)
  // came from this helper only being applied to ONE of the three call
  // sites — the other two silently missed the modal's only fair chance to
  // fire, so it didn't show up until whichever LATER launch happened to
  // have the scan already done before its own immediate notifyPostMount()
  // ran, reading as "the modal showed up again after I already exited and
  // came back" rather than "it finally got shown." `getApi` is a closure
  // (not a plain `api` value) since each call site's own `api` variable is
  // still `undefined` at the moment this function is defined/passed in —
  // only set once `sessionsView()`'s `onReady` fires, before
  // startTuiRoutine()'s callback can ever run.
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
    // Mount the (empty) sessions view FIRST, then show the persona picker on
    // top of it — so the picker has the real TUI chrome (header/panels/
    // statusbar) behind it instead of a bare screen. Genuinely empty is the
    // point now: prepareTutorialProvider() below only wires up the LLM mock
    // + knowledge pre-stage, not any visible session rows — those land later,
    // the moment the tutorial's own Scan step is triggered (see tutorial.js's
    // doc comment), so the Sessions view stays empty straight through this
    // whole picker sequence.
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
          { reloadSessions: () => api.reloadAll() },
        );
      });
    });
    return;
  }

  // Background upkeep (scan/organize/digest) runs inside this same process
  // for as long as the TUI is open, on the same timers a standalone daemon
  // would use — see daemon.js's startTuiRoutine() for why this replaced an
  // auto-spawned separate process. Stops naturally when the TUI exits.
  //
  // Deliberately NOT called here, before the onboarded check below — a real
  // bug found in production (v0.1.0): startTuiRoutine() kicks off scanCycle()
  // without awaiting it, so it runs concurrently with the first-run
  // onboarding flow below. On a brand new install, that flow spends real
  // wall-clock time on language/tour/persona pickers, then the tutorial's own
  // early steps, before injectDemoSessions() ever writes the first mock
  // session (now deferred all the way to the Scan step — see tutorial.js) —
  // plenty of time for the real scan to import actual ~/.claude/~/.codex/
  // ~/.kiro history into ~/.mycelium first.
  // sessionsView() shows ALL unfiled sessions, not just demo:true ones, so
  // the tutorial ended up showing a mix of real personal session titles
  // alongside the mock ones — exactly the "adapters read real data
  // regardless of MYCELIUM_HOME" hazard demo/pitch-launch.js's own header
  // comment warns about, just triggered by a real user's real first launch
  // instead of a recording. Fixed by moving each call below to fire only
  // once onboarding has genuinely concluded (tutorial completed or
  // declined, or this isn't a first launch at all) — never racing it.
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
    // forceTutorial branch above — every picker shown from here on (language,
    // tour prompt, persona) gets real TUI chrome behind it instead of a bare
    // screen. Stays empty even if the human picks the tour: see the
    // forceTutorial branch's comment for why session rows are now deferred
    // to the tutorial's own Scan step rather than seeded here.
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

  // Already onboarded — no tutorial/mock-seeding race to avoid here, so this
  // is the one path where starting real background upkeep right away (same
  // as it always did) is safe. See startUpkeepAndRecheck()'s own comment
  // (top of this function) for why the re-check callback matters — this is
  // the branch a `mycelium demo` handoff always lands on (cli.js stamps
  // onboarded:true before calling runTui()), so it's also the one every
  // earlier VHS verification pass exercised. Calling notifyPostMount()
  // twice (once here immediately, once again once the callback fires) is
  // safe: gated on config.json's firstScanModalShown (won't double-show the
  // modal), and on the common, non-fresh case (index already has data from
  // a prior run) the immediate call below already has accurate numbers, so
  // the callback just re-does the same no-op check a moment later.
  //
  // Mount + render FIRST, THEN start upkeep — a real bug found via VHS
  // frame timing: scan() (scanner.js) is a plain synchronous function
  // (readFileSync/readdirSync throughout, no async I/O), so scanCycle()
  // calling it (`const res = scan();`, no await) blocks the ENTIRE event
  // loop for however long a real scan takes (measured ~1.9s for 65
  // sessions via the daemon log; scales with real backlog size) —
  // "fire-and-forget" only describes the Promise chain, not actual CPU
  // time. Calling startUpkeepAndRecheck() before app.show()/app.render()
  // used to mean that synchronous block ran BEFORE the first paint could
  // even happen, since both statements share the same synchronous call
  // stack up to the first real await — nothing reaches the terminal until
  // scan() returns. The transitional message in cli.js's handoff branch
  // (demo.handoffTransition) was staying on screen for that whole
  // multi-second stretch with no visible progress, exactly the "still
  // delays, feels frozen" symptom. Painting first means the shell (however
  // briefly empty) is what's on screen during that unavoidable block,
  // instead of nothing — startUpkeepAndRecheck()'s own callback still
  // fixes up the numbers once the scan actually finishes.
  let api;
  await app.show(sessionsView({ onReady: (a) => (api = a) }));
  app.render();
  startUpkeepAndRecheck(() => api);
  // Belt-and-suspenders alongside startUpkeepAndRecheck()'s own callback:
  // scanCycle()'s onScanned hook now fires synchronously within THIS same
  // call stack (right after scan()+reindex(), before its own first real
  // await), so by the time control reaches this line the callback above
  // has typically already run once — this second reloadAll() is a no-op
  // in that case. Kept explicit anyway so this stays correct even if that
  // synchronous coupling ever changes (e.g. scan() becoming real async
  // I/O), rather than depending on exact timing between two files.
  api?.reloadAll();
  notifyPostMount(app);
}

if (import.meta.url === `file://${process.argv[1]}`) runTui();
