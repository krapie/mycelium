import { launchAgent, resumeSession } from './launch.js';
import { resumeCommandLine } from '../agents.js';
import { buildHandoff } from '../handoff.js';
import { foldProductIntoSession } from '../organize.js';
import * as data from './data.js';
import { menu } from './widgets/pickers.js';
import { copyToClipboard } from './clipboard.js';
import { t } from './i18n.js';

/**
 * Wires the resume/handoff/copy-command trio shared by the Sessions panel
 * (listBox/detailBox) and the Calendar tab's day-list/detail — same
 * underlying functions and ~40 lines that used to be duplicated wholesale
 * between sessions.js and calendar.js (self-acknowledged in a comment there).
 *
 * `getCurrentRow()` — the view's "what's selected right now" accessor
 * (sessions.js passes `currentRow`; calendar.js passes
 * `() => dayRows[dayListBox.selected]`).
 *
 * `afterResume`/`afterHandoff` — called once the launch/fold completes.
 * Kept as two separate callbacks rather than one, because the views
 * genuinely differ here: sessions.js's actual-resume path explicitly
 * returns to the 'sessions' level, but its handoff path doesn't (handoff is
 * only ever bound from the list level there, never from detail); calendar.js
 * uses the same afterAction() for both. That's a real, pre-existing
 * difference this extraction preserves rather than silently unifies.
 */
export function createResumeHandoff(app, { getCurrentRow, afterResume, afterHandoff }) {
  const doActualResume = (session) => {
    // resumeSession() (launch.js) already reindexes exactly what changed.
    resumeSession(app, session, afterResume);
  };

  // Reuse: hand the current session off to another agent (seeded NEW
  // session). `fallback: true` means this handoff is doResume()'s
  // substitute for a merge/split product that has no real agent-native id
  // to resume — explain that in the agent-picker's own title instead of a
  // separate app.notify() toast, which would just visibly overlap the
  // picker (both are centered overlays and the picker opens in the same
  // tick, before a timed toast has any time to be read).
  const doHandoff = ({ fallback = false } = {}) => {
    const r = getCurrentRow();
    if (!r) return;
    const hb = buildHandoff(r.id);
    if (!hb.ok) return app.notify(hb.error, 3);
    const isDerived = r.mergedFrom?.length || r.splitFrom;
    // Default the new session's working dir to the handed-off session's own
    // dir (row rows don't carry cwd/projectDir — load the raw record). Falls
    // back to undefined (resolveDir then uses process.cwd()) if unknown.
    const n = data.detail(r.id);
    const defaultDir = n?.projectDir || n?.cwd || undefined;
    // launchAgent() (launch.js) already reindexes exactly what changed, and
    // already linkContinuation()s the new session to r.id.
    launchAgent(app, { folder: r.folder, seed: hb.prompt, parentId: r.id, defaultDir, title: fallback ? t('launch.selectAgentFallback') : t('launch.selectAgentHandoff') }, (mine) => {
      // A merge/split product only ever existed to seed this handoff — once
      // a real, directly-resumable session exists, fold the product's
      // content into it and drop the product entirely, so there's one
      // ordinary session left (not two rows, and no continued
      // special-casing: from here on `r` on the new session is just a
      // normal resume, see organize.js's foldProductIntoSession).
      if (isDerived && mine?.[0]) {
        const res = foldProductIntoSession(r.id, mine[0].id);
        if (res.ok) {
          data.refreshOne(r.id); // gone — reindex removes it
          data.refreshOne(mine[0].id); // now holds the folded turns
          data.refreshMany(res.touchedIds || []); // their backlinks changed too
        }
      }
      afterHandoff();
    });
  };

  // Reuse: RESUME the exact session in its original agent (claude --resume /
  // codex resume). A merge/split product has no real agent-native id to
  // resume — falls back to handoff, which folds the product into whatever
  // real session that produces (see doHandoff above), so this only ever
  // happens once per product: after that it's gone, replaced by an ordinary
  // session that resumes normally.
  const doResume = () => {
    const r = getCurrentRow();
    if (!r) return;
    const n = data.detail(r.id);
    if (n?.mergedFrom?.length || n?.splitFrom) return doHandoff({ fallback: true });
    doActualResume({ id: r.id, source: r.source, cwd: n?.cwd, projectDir: n?.projectDir });
  };

  // Detail panel's Enter — the leaf level, so Enter (the drill-down/act key
  // everywhere else) is free here. Unlike the list's `r` (instant resume),
  // Enter offers a choice: resume right here, or copy the equivalent shell
  // command for a new tab.
  const onDetailEnter = () => {
    const r = getCurrentRow();
    if (!r) return;
    // "Copy command" pastes into a brand-new terminal outside the TUI —
    // there's no way to auto-absorb through that path, and a merge/split
    // product's id isn't a real agent-native session id to begin with, so
    // the copied command would just fail with "session not found" when
    // actually run. Only offer it for a real, truly resumable session.
    const isDerived = r.mergedFrom?.length || r.splitFrom;
    const choices = [{ label: t('resume.openHere'), value: 'here' }];
    if (!isDerived) choices.push({ label: t('resume.copyCommand'), value: 'copy' });
    menu(app, t('resume.chooseAction'), choices, (choice) => {
      if (choice === 'here') return doResume();
      if (choice === 'copy') {
        const n = data.detail(r.id);
        const res = resumeCommandLine({ id: r.id, source: r.source, cwd: n?.cwd, projectDir: n?.projectDir });
        if (!res.ok) return app.notify(res.error, 3);
        // Longer duration + the actual command line, not just "copied" —
        // pasting blind into a new tab without knowing what you're about to
        // run isn't great, and if the copy itself failed (no clipboard
        // tool), showing the line is how you'd get it at all.
        app.notify(copyToClipboard(res.line) ? t('resume.copied', res.line) : t('resume.copyFailed', res.line), 6);
      }
    });
  };

  return { doResume, doHandoff, onDetailEnter };
}
