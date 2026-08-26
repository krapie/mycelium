import { C } from '../theme.js';
import * as data from '../data.js';
import {
  mergeSessions,
  unmerge,
  suggestPlacements,
  applyPlacements,
  summarizeCandidates,
  pendingSuggestions,
  queueSuggestions,
  clearSuggestions,
  classificationCandidates,
  listTreeDirs,
} from '../../organize.js';
import { suggestSplitBoundaries, applySplit, unsplit } from '../../split.js';
import { scan } from '../../scanner.js';
import { multiSelectList, textPrompt } from '../widgets/pickers.js';
import { confirmText } from '../widgets/viewers.js';
import { autoTagSession } from '../../learn.js';
import { mapConcurrent } from '../../llm.js';
import {
  buildKnowledgeText,
  writeKnowledgeText,
  pendingKnowledgeReviews,
  promoteKnowledge,
  dismissPendingKnowledge,
  proposeKnowledgeRefreshes,
} from '../../insight.js';
import { injectAgentsMd, dirsForFolder } from '../../reuse.js';
import { launchAgent } from '../launch.js';
import { t } from '../i18n.js';

// The Scan/Organize/Knowledge-review/Merge/Split/New-agent action handlers
// bound by sessions.js's screenKey/listBox.key/foldersBox.key/openActionMenu
// — split out because each is a substantial, mostly self-contained LLM- or
// mutation-driving flow (Phase 2 split, issue #88). Each takes an explicit
// `ctx` (built once by sessions.js's mount()) instead of closing over
// mount()'s locals directly. `ctx.asyncReviewFlowRunning` is the one field
// these functions actually mutate (guards a double-press race stacking a
// second review modal — see its own comment below); everything else on ctx
// (app/state/boxes/currentRow/reloadFolders/reloadList) is a stable
// reference for the view's whole lifetime.

// Caps the number of sessions summarized by one `o` run, so a large
// first-time backlog cannot exhaust a tight usage quota. Lower than
// suggestPlacements()'s limit:200 because summarizing costs more per item.
const SUMMARIZE_BATCH_LIMIT = Number(process.env.MYCELIUM_SUMMARIZE_BATCH_LIMIT || 30);

// Prefills the merge title with the shared folder's leaf name (e.g.
// `cases/onprem-connectivity` → "Onprem Connectivity") — only when all
// merged sessions actually share one folder, matching mergeSessions()'s own
// placement rule. Cheap and local, no LLM call; still a plain editable
// textPrompt, just a starting point.
function suggestMergeTitle(ids) {
  const folders = new Set(ids.map((id) => data.detail(id)?.folder || null));
  if (folders.size !== 1) return '';
  const folder = [...folders][0];
  if (!folder) return '';
  return folder
    .split('/')
    .pop()
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

// s: scan only (capture new/changed sessions from every tab/terminal +
// reindex), without leaving the TUI. Mirrors `mycelium scan`. Captured
// sessions land unfiled — use `o` (or `mycelium organize`) to place them.
export function doScan(ctx) {
  const { app, reloadFolders, reloadList } = ctx;
  app.notify(t('scan.inProgress'), 30);
  setImmediate(() => {
    let s;
    try {
      s = scan();
    } catch (err) {
      app.notify(t('scan.failed', err.message), 4);
      return;
    }
    data.refresh();
    reloadFolders();
    reloadList();
    app.notify(t('scan.done', s.imported, s.scanned, s.skipped, s.failed), 4);
    app.render();
    // Tutorial-only hook (see tutorial.js's app.tutorialSignal) — fired
    // at genuine completion, not function-entry: scan has no review
    // modal for isModalOpen() to poll (unlike o/w/merge/split), so this
    // timing IS the narrator's only real completion signal.
    app.tutorialSignal?.('scan');
  });
}

// o: smart organize — LLM content-based folder suggestions (see
// organize.js's suggestPlacements()). Fresh candidates are scoped to
// state.folder (Root/New/subtree, same semantics as data.sessions()),
// so reviewing "this folder" doesn't drag in the whole store. Always
// preview-then-confirm, unlike `s`'s plain scan.
export async function doOrganize(ctx) {
  // See ctx.asyncReviewFlowRunning's own comment above — an impatient
  // repeat press while the LLM call is still in flight used to start
  // a second concurrent run.
  if (ctx.asyncReviewFlowRunning) return;
  ctx.asyncReviewFlowRunning = true;
  // Tutorial-only hook, same reasoning as doMerge's — past the
  // in-flight guard above, so a swallowed impatient repeat press never
  // double-fires it (harmless either way, tutorial.js's own signal
  // handler no-ops while already waiting, but there's no reason to
  // rely on that here too).
  ctx.app.tutorialSignal?.('organize');
  try {
    await runSmartOrganize(ctx);
  } finally {
    ctx.asyncReviewFlowRunning = false;
  }
}

async function runSmartOrganize(ctx) {
  const { app, state, reloadFolders, reloadList } = ctx;
  // Reuse whatever the daemon already queued (organize.js's
  // smartOrganizeCycle) instead of recomputing — makes `o` instant.
  // Deliberately unscoped (not filtered to state.folder): scoping this
  // was tried and backfired, silently ignoring a real pending
  // suggestion outside the current folder and recomputing for nothing.
  let matches = pendingSuggestions();
  if (!matches.length) {
    // Only summarizes sessions actually being classified, not the
    // whole backlog.
    const pending = classificationCandidates({ cooldownMs: 0, folder: state.folder }).filter(
      (n) => !n.extracted.summary,
    ).length;
    // Real progress bars, not the animated-but-fake spinner — both
    // phases know a true total up front.
    const summarizeSpin = pending ? app.startProgressBar(t('sessions.summarizingLabel')) : null;
    const summarized = [];
    let summarizedDone = 0;
    const summarizeRes = await summarizeCandidates({
      folder: state.folder,
      // Bounds this call's own subprocess volume — see
      // SUMMARIZE_BATCH_LIMIT's own comment above. Pressing `o` again
      // continues where this left off (already-summarized candidates
      // are excluded up front, see classificationCandidates() above).
      limit: SUMMARIZE_BATCH_LIMIT,
      onProgress: (s) => {
        if (s) summarized.push(s.id);
        summarizeSpin?.update(++summarizedDone, pending);
      },
    });
    summarizeSpin?.stop();
    // Only the just-summarized sessions actually changed.
    if (summarized.length) data.refreshMany(summarized);
    // A real usage-limit exhaustion trips summarizeCandidates()'s own
    // circuit breaker (see organize.js) before suggestPlacements() is
    // even attempted — every already-summarized session's progress is
    // safe (each one is written to disk as it completes), so this is
    // "stop here, not everything is lost," not a hard failure.
    if (summarizeRes.stoppedEarly) {
      return app.notify(t('smart.summarizeStoppedEarly', summarizeRes.done, summarizeRes.total), 8);
    }
    const placeSpin = app.startProgressBar(t('smart.running'));
    const res = await suggestPlacements({
      cooldownMs: 0,
      folder: state.folder,
      // Same reasoning as daemon.js's SMART_ORGANIZE_BATCH_LIMIT — a
      // large backlog could otherwise mean hundreds of LLM calls in
      // one `o` press.
      limit: 200,
      onProgress: (batch, total) => placeSpin.update(batch, total),
    });
    placeSpin.stop();
    if (!res.ok) return app.notify(res.error, 4);
    matches = res.placements.filter((p) => p.folder);
    // A partial failure (some chunks succeeded, one hit real usage
    // exhaustion) still has real placements worth reviewing — surface
    // both: whatever's usable below, plus why the rest is missing.
    if (res.error) app.notify(t('smart.placementsStoppedEarly', res.error), 6);
    if (!matches.length) return app.notify(t('smart.noMatches'), 3);
    queueSuggestions(matches);
  }
  // Cherry-pick which suggestions to actually apply — every suggestion
  // starts checked (LLM already did the picking; this is a chance to
  // catch a bad one, not to opt in one at a time) — Enter alone applies
  // everything, Space toggles off whichever ones look wrong.
  const existingDirs = new Set(listTreeDirs());
  const items = matches.map((p) => ({
    label: `${p.id.slice(0, 8)}  → {${C.fox}-fg}${p.folder}{/}${
      existingDirs.has(p.folder) ? '' : `  {${C.spore}-fg}(${t('smart.newFolder')}){/}`
    }${p.reason ? `  {${C.faint}-fg}(${p.reason}){/}` : ''}`,
    value: p,
  }));
  multiSelectList(app, t('smart.previewTitle'), items, (chosen) => {
    // Esc means what its own "esc cancel" label says — dismiss this
    // batch. Reviewed (Esc or Enter, applied or passed on) either way,
    // so it's cleared from the queue and won't keep reappearing next
    // `o` — re-pressing `o` later recomputes fresh candidates instead.
    clearSuggestions(matches.map((p) => p.id));
    if (chosen) {
      applyPlacements(chosen);
      // Only the applied ones' `folder` actually changed — the rest
      // just had suggestedFolder cleared, which isn't indexed at all.
      data.refreshMany(chosen.map((p) => p.id));
    }
    reloadFolders();
    reloadList();
    app.render();
  }, { defaultAll: true });
}

// k: knowledge review — mirrors o's shape (reuse what the daemon
// queued overnight, else compute fresh), deliberately separate from
// Digest (`d`). Both this and the daemon's own knowledgeReviewCycle
// call the same insight.js proposeKnowledgeRefreshes().
export async function doRefreshKnowledge(ctx) {
  if (ctx.asyncReviewFlowRunning) return;
  ctx.asyncReviewFlowRunning = true;
  try {
    await runKnowledgeReview(ctx);
  } finally {
    ctx.asyncReviewFlowRunning = false;
  }
}

async function runKnowledgeReview(ctx) {
  const { app } = ctx;
  let pending = pendingKnowledgeReviews();
  if (!pending.length) {
    // Nothing queued from an overnight cycle — compute fresh for
    // TODAY's active folders, right now. This is the "compute on the
    // spot" branch o's own runSmartOrganize() also falls back to when
    // nothing's pre-queued.
    const today = new Date().toISOString().slice(0, 10);
    const spin = app.startSpinner(t('knowledge.reviewRunning'));
    await proposeKnowledgeRefreshes(today);
    spin.stop();
    pending = pendingKnowledgeReviews();
    if (!pending.length) return app.notify(t('knowledge.reviewNone'), 3);
  }
  const items = pending.map((p) => ({
    label: `${p.folder}  {${C.faint}-fg}${p.text.split('\n').find((l) => l.trim() && !l.startsWith('#'))?.trim().slice(0, 60) || ''}{/}`,
    value: p.folder,
  }));
  multiSelectList(app, t('knowledge.reviewTitle'), items, (chosen) => {
    const chosenSet = new Set(chosen || []);
    const toPromote = [];
    for (const p of pending) {
      if (chosenSet.has(p.folder)) toPromote.push(p);
      else dismissPendingKnowledge(p.folder);
    }
    applyKnowledgeApprovals(ctx, toPromote);
  }, {
    defaultAll: true,
    // Full-content review before approving — the one-line label
    // snippet isn't enough to actually judge what's about to land in
    // KNOWLEDGE.md (and from there, some real project's AGENTS.md).
    previewText: (folder) => pending.find((p) => p.folder === folder)?.text || '',
  });
}

// Approving KNOWLEDGE.md content is one decision; which real project
// directories get it is a separate one — a folder can span several
// directories a session merely ran in, and dirsForFolder() can't tell
// "the project" from "somewhere incidental". 0-1 directory injects
// straight through; 2+ shows a pre-checked checklist to catch a stray one.
function applyKnowledgeApprovals(ctx, toPromote) {
  const { app } = ctx;
  let applied = 0;
  const ambiguous = [];
  for (const p of toPromote) {
    const res = promoteKnowledge(p.folder);
    if (!res.ok) continue;
    applied++;
    const dirs = dirsForFolder(p.folder);
    if (dirs.length <= 1) {
      for (const dir of dirs) {
        try {
          injectAgentsMd(dir, p.folder);
        } catch {
          /* no reachable AGENTS.md target — fine, best-effort */
        }
      }
    } else {
      for (const dir of dirs) ambiguous.push({ folder: p.folder, dir });
    }
  }
  if (!ambiguous.length) {
    return app.notify(applied ? t('knowledge.reviewApplied', applied) : t('knowledge.reviewSkipped'), 4);
  }
  const items = ambiguous.map((c) => ({
    label: `${c.folder}  {${C.faint}-fg}→ ${c.dir}{/}`,
    value: c,
  }));
  multiSelectList(app, t('knowledge.injectDirsTitle'), items, (chosenDirs) => {
    for (const c of chosenDirs || []) {
      try {
        injectAgentsMd(c.dir, c.folder);
      } catch {
        /* no reachable AGENTS.md target — fine, best-effort */
      }
    }
    app.notify(applied ? t('knowledge.reviewApplied', applied) : t('knowledge.reviewSkipped'), 4);
  }, { defaultAll: true });
}

// Shift+M: merge the multi-selected sessions into one new synthetic
// session — git-like (originals' turns untouched, just superseded;
// reversible via `mycelium unmerge`). Blessed reports Shift+letter as
// 'S-<letter>'. Same key also REVERTS when there's nothing to merge
// (0-1 targets that turn out to be a merge product already) — brings
// unmerge(), previously CLI-only, into the TUI without a second key.
function doUnmerge(ctx, id) {
  const { app, state, listBox, reloadFolders, reloadList } = ctx;
  const n = data.detail(id);
  if (!n?.mergedFrom?.length) return false;
  const res = unmerge(id);
  if (!res.ok) {
    app.notify(res.error, 3);
    return true;
  }
  state.selected.clear();
  data.refreshMany([id, ...res.restored.map((s) => s.id)]);
  reloadFolders();
  reloadList();
  app.notify(t('merge.reverted', res.restored.length), 3);
  listBox.focus();
  app.render();
  return true;
}

export function doMerge(ctx) {
  const { app, state, listBox, currentRow, reloadFolders, reloadList } = ctx;
  const ids = [...state.selected];
  if (ids.length <= 1) {
    const targetId = ids[0] ?? currentRow()?.id;
    if (targetId && doUnmerge(ctx, targetId)) return;
  }
  if (ids.length < 2) return app.notify(t('merge.needsTwo'), 3);
  // See ctx.asyncReviewFlowRunning's own comment above — guards only the
  // title prompt, released once it closes.
  if (ctx.asyncReviewFlowRunning) return;
  ctx.asyncReviewFlowRunning = true;
  // Tutorial-only hook (see tutorial.js's app.tutorialSignal) — lets
  // the narrator advance whether Shift+M was pressed directly or
  // selected from the `.` action menu, since both call this exact
  // function. Placed here, past the <2-selected no-op above, so a
  // no-op press never fires a false "merge happened" signal.
  app.tutorialSignal?.('merge');
  textPrompt(app, t('merge.titlePrompt'), suggestMergeTitle(ids), async (title) => {
    ctx.asyncReviewFlowRunning = false;
    if (title === null) return listBox.focus(); // Esc — cancelled
    const res = mergeSessions(ids, { title: title.trim() || undefined });
    if (!res.ok) return app.notify(res.error, 3);
    state.selected.clear();
    data.refreshMany([res.merged.id, ...ids]);
    reloadFolders();
    reloadList();
    // Restore focus/render before the async auto-summarize below —
    // textPrompt's blessed.prompt takes focus while open and doesn't
    // hand it back, so waiting until after the LLM call left listBox
    // deaf to the next keypress for however long that took.
    listBox.focus();
    app.render();
    // Real title/summary/tags for the merged result, same call `a`
    // uses — best-effort: a failure here doesn't undo the merge, just
    // leaves it for a later manual `a`.
    const spin = app.startSpinner(t('merge.summarizing'));
    try {
      await autoTagSession(res.merged.id);
    } catch {
      /* best-effort — merge already succeeded regardless */
    }
    spin.stop();
    data.refreshOne(res.merged.id);
    reloadList();
    // Includes the actual id so the toast itself says how to undo
    // (`mycelium unmerge <id>`) — a bare "Merged N sessions" gave no
    // hint it could be undone at all, let alone how. 4s (was 6s, felt
    // too long lingering on screen) — still enough to read the id.
    app.notify(t('merge.done', ids.length, res.merged.id.slice(0, 8)), 4);
    app.render();
  });
}

// Shift+S: LLM-suggested split — propose topic boundaries, human
// reviews via the same multiSelectList pattern smart-organize (`o`)
// uses, apply only the checked ranges (unchecked ranges simply stay
// part of the original — nothing is lost either way).
export async function doSplit(ctx) {
  const { app, listBox, currentRow, reloadFolders, reloadList } = ctx;
  const r = currentRow();
  if (!r) return;
  // Same key REVERTS when the current row IS a split piece — same
  // "same key, no valid forward action here anyway" pattern as
  // Shift+M's doUnmerge() above. A piece proposing its OWN fresh
  // split (on its own partial content) was never a meaningful action
  // to preserve here, and unsplit()/unmerge() were previously
  // CLI-only — this is the TUI-reachable path the merge/split.done
  // toasts have pointed at since `mycelium unsplit <id>` was added.
  if (r.splitFrom) {
    const res = unsplit(r.splitFrom);
    if (!res.ok) return app.notify(res.error, 3);
    data.refreshMany([r.splitFrom, ...res.removed]);
    reloadFolders();
    reloadList();
    app.notify(t('split.reverted', res.removed.length), 3);
    listBox.focus();
    app.render();
    return;
  }
  // See ctx.asyncReviewFlowRunning's own comment above.
  if (ctx.asyncReviewFlowRunning) return;
  ctx.asyncReviewFlowRunning = true;
  // Tutorial-only hook, same reasoning as doMerge's — past the
  // no-current-row/unsplit-revert branches above, so it only fires on
  // a genuine forward split attempt.
  app.tutorialSignal?.('split');
  const spin = app.startSpinner(t('split.suggesting'));
  const res = await suggestSplitBoundaries(r.id);
  spin.stop();
  if (!res.ok) {
    ctx.asyncReviewFlowRunning = false;
    return app.notify(res.error, 3);
  }
  const items = res.ranges.map((rg) => ({ label: t('split.turnRangeLabel', rg.from, rg.to, rg.label), value: rg }));
  // defaultAll: true, same as smart-organize's review — the LLM
  // already proposed these ranges, so reviewing means "uncheck the
  // wrong one," not "check the right ones." Guard released once the
  // modal opens, same scope as `o`/`w`'s guards.
  ctx.asyncReviewFlowRunning = false;
  multiSelectList(app, t('split.reviewTitle'), items, async (chosen) => {
    if (!chosen?.length) return; // Esc or everything unchecked — original untouched
    const applied = applySplit(r.id, chosen);
    if (!applied.ok) return app.notify(applied.error, 3);
    data.refreshMany([r.id, ...applied.pieces.map((p) => p.id)]);
    reloadFolders();
    reloadList();
    // Restore focus/render before the async auto-summarize below —
    // same reasoning as the merge handler above.
    listBox.focus();
    app.render();
    // Real summary for each piece, same call `a` uses (titles are
    // already real, from the boundary labels, and locked). Bounded
    // concurrency, same as organize.js (see issue #3); best-effort per
    // piece. Deliberately not re-arming ctx.asyncReviewFlowRunning here
    // — an earlier attempt did, to protect the shared toast, but that
    // blocked legitimate immediate follow-ups like another Shift+S.
    const spin2 = app.startSpinner(t('split.summarizing'));
    try {
      await mapConcurrent(applied.pieces, 2, (p) => autoTagSession(p.id).catch(() => {}));
    } finally {
      spin2.stop();
    }
    data.refreshMany(applied.pieces.map((p) => p.id));
    reloadList();
    // Includes the original's id so the toast itself says how to
    // undo (`mycelium unsplit <id>`, pieces deleted, original
    // untouched) — a bare "Split into N sessions" gave no hint it
    // could be undone at all, let alone how. 4s (was 6s, felt too
    // long lingering on screen) — still enough to read the id.
    app.notify(t('split.done', applied.pieces.length, r.id.slice(0, 8)), 4);
    app.render();
  }, { defaultAll: true });
}

// w: extract KNOWLEDGE.md for the current folder — generate, show the
// human what it's about to write (it feeds AGENTS.md for every future
// session in this folder), and only save on explicit confirm.
export async function doKnowledge(ctx) {
  const { app, state, foldersBox, listBox } = ctx;
  if (!state.folder) return app.notify(t('folders.selectFirst'), 3);
  // See ctx.asyncReviewFlowRunning's own comment above — an impatient
  // repeat press while the LLM call is still in flight used to start
  // a second concurrent run.
  if (ctx.asyncReviewFlowRunning) return;
  ctx.asyncReviewFlowRunning = true;
  // Tutorial-only hook, same reasoning as doMerge's — past the
  // no-folder-selected guard above.
  app.tutorialSignal?.('knowledge');
  const refocus = () => (state.level === 'folders' ? foldersBox : listBox).focus();
  try {
    // startSpinner() (app.js) both animates the wait and keeps the
    // toast alive for however long buildKnowledgeText() actually takes
    // — it used to be a fixed-duration notify() that could expire
    // mid-call on a slow/large folder, leaving nothing on screen well
    // before the call actually finished. stop() dismisses it
    // explicitly either way, same as the old dismissNotify() call did
    // before the preview opens.
    const spin = app.startSpinner(t('knowledge.generating'));
    const gen = await buildKnowledgeText(state.folder);
    spin.stop();
    if (!gen.ok) {
      app.notify(gen.error, 3);
      return refocus();
    }
    confirmText(app, t('knowledge.previewTitle', state.folder), gen.text, (ok) => {
      if (!ok) {
        app.notify(t('knowledge.cancelled'), 2);
        return refocus();
      }
      const w = writeKnowledgeText(state.folder, gen.text);
      app.notify(w.ok ? t('knowledge.saved', state.folder) : w.error, 3);
      refocus();
    });
  } finally {
    ctx.asyncReviewFlowRunning = false;
  }
}

// Capture: launch a new agent session in the current folder's context.
// launchAgent() (launch.js) asks "open here or copy command" — "copy
// command" doesn't capture anything, so the refresh below is a
// harmless no-op in that case. FOLDER-scoped (state.folder, not the
// selected row) — real bug found while wiring up the tutorial's own `n`
// step: it used to be a listBox-only binding, so pressing `n` while the
// Folders panel had focus silently did nothing, even though the `.` menu's
// own FOLDER group already documented it as "available from both the
// sessions list and the folders panel." Bound explicitly on both boxes
// (sessions.js) — confirmed via a headless dry run that a screenKey would
// let a second `n` press re-enter this whole flow while the agent/directory
// picker it just opened still has focus, stacking a second one on top; an
// explicit per-box binding naturally can't fire once focus has moved to a
// different widget.
export function doNewAgent(ctx) {
  const { app, state, foldersBox, listBox, reloadFolders, reloadList } = ctx;
  // Tutorial-only hook, same reasoning as doOrganize's — a real
  // modal (the agent picker) follows, so isModalOpen() polling is
  // what actually gates the narrator's advance; this signal only
  // matters for `.`-menu forward-skip support.
  app.tutorialSignal?.('newAgent');
  // app.tutorialSignal is only set while the tutorial is running (see
  // tutorial.js) — reused here as the "is this the tutorial" check so
  // its `n` step never risks foregrounding a real agent subprocess,
  // and seeds the copied command with a prompt that makes the
  // handed-off agent immediately report what it inherited.
  const inTutorial = !!app.tutorialSignal;
  // Restore whichever panel actually had focus when `n` fired
  // (foldersBox or listBox), not unconditionally listBox — found via
  // CodeRabbit review on #97: pressing `n` from the Folders panel and
  // then cancelling used to leave focus stranded on Sessions instead
  // of back on Folders. Same state.level check doKnowledge()'s own
  // refocus() already uses for the identical situation.
  const refocus = () => (state.level === 'folders' ? foldersBox : listBox).focus();
  launchAgent(
    app,
    {
      folder: state.folder,
      title: t('launch.selectAgentNew'),
      copyOnly: inTutorial,
      seed: inTutorial ? t('tutorial.newAgentSeed') : undefined,
    },
    () => {
      reloadFolders();
      reloadList();
      refocus();
      app.render();
    },
  );
}
