import pkg from 'neo-blessed';
const blessed = pkg.default || pkg;
import { C, sourceColor, sourceLabel } from '../theme.js';
import * as data from '../data.js';
import {
  move as organizeMove,
  tag as organizeTag,
  mkdir,
  renameFolder,
  deleteFolder,
  deleteSession,
  setContent,
  suggestPlacements,
  applyPlacements,
  summarizeCandidates,
  pendingSuggestions,
  queueSuggestions,
  clearSuggestions,
  classificationCandidates,
  listTreeDirs,
  mergeSessions,
  unmerge,
} from '../../organize.js';
import { suggestSplitBoundaries, applySplit, unsplit } from '../../split.js';
import { scan } from '../../scanner.js';
import { pickFolder, editTags, menu, multiSelectList } from '../widgets/pickers.js';
import { createCalendarTab } from './calendar.js';
import { formatSessionDetail } from '../render.js';
import { basename } from 'node:path';
import { launchAgent } from '../launch.js';
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
import { assembleContext, injectAgentsMd, dirsForFolder } from '../../reuse.js';
import { textView, digestReader, confirmText, helpModal, welcomeModal } from '../widgets/viewers.js';
import { textPrompt } from '../widgets/pickers.js';
import { copyToClipboard } from '../clipboard.js';
import { t } from '../i18n.js';
import { createResumeHandoff } from '../resume-handoff.js';

// A large first-time backlog (hundreds of unfiled sessions from a fresh
// import) would otherwise mean that many real claude/codex subprocess
// calls in one `o` press — easily enough to exhaust a tighter usage quota
// mid-run (see "session 100% usage" reports). Same env-override convention
// as daemon/cycles.js's TAG_BATCH_LIMIT/SMART_ORGANIZE_BATCH_LIMIT. Kept
// separate from suggestPlacements()'s own limit:200 below — summarizing is
// the more expensive per-item cost (a full session's turns vs. a compact
// summary line), so it gets the tighter cap.
const SUMMARIZE_BATCH_LIMIT = Number(process.env.MYCELIUM_SUMMARIZE_BATCH_LIMIT || 30);

// Plain-text rendering of a session for the clipboard (title, summary, and the
// full transcript — everything you'd want to paste elsewhere).
function sessionToText(n) {
  const L = [];
  if (n.extracted.title) L.push(`# ${n.extracted.title}`);
  L.push(`${n.source} · ${(n.startedAt || '').slice(0, 16).replace('T', ' ')} · ${n.folder || t('sessions.newBadge')}`, '');
  if (n.extracted.summary) L.push(t('export.summary'), n.extracted.summary, '');
  if (n.extracted.decisions?.length) L.push(t('export.decisions'), ...n.extracted.decisions.map((d) => `- ${d}`), '');
  if (n.extracted.todos?.length) L.push(t('export.todos'), ...n.extracted.todos.map((td) => `- ${td}`), '');
  if (n.artifacts.filesChanged?.length) L.push(t('export.files'), ...n.artifacts.filesChanged.map((f) => `- ${f}`), '');
  L.push(t('export.conversation'));
  for (const turn of n.turns) L.push(`[${turn.role}] ${turn.text}`, '');
  return L.join('\n');
}

// Prefills the merge title prompt with a sensible default instead of a bare
// blank field — same "shared folder" agreement mergeSessions() itself uses
// to decide where the merged record lands (folders.size === 1 && truthy),
// so the suggestion only appears when it's actually meaningful (sessions
// merged from different/unfiled folders get no suggestion, same as they get
// no folder placement). The folder's own leaf name is usually a good stand-in
// for "what this merge is about" — e.g. `cases/onprem-connectivity` suggests
// "Onprem Connectivity" — cheap, local, and needs no LLM call, unlike a
// real summary would. Purely a starting point: still a plain textPrompt, so
// it's fully editable or clearable before merging.
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

/**
 * The main cockpit view: folder tree (left), session list (right top), detail
 * (right bottom). Tab cycles focus; / searches; Enter drills into detail. The
 * organize/capture/reuse action keys are attached here and delegate to widgets
 * added in later build steps.
 */
export function sessionsView(opts = {}) {
  // state.folder's three sentinels match data.sessions()/organize.js's own
  // folder-scoping contract exactly, so they pass straight through with no
  // translation anywhere they're used: undefined = Root (everything), null =
  // the New pseudo-folder (genuinely unfiled only), a path = that folder's
  // subtree.
  let state = { folder: undefined, query: '', tags: [], selected: new Set(), sortBy: 'recent' };
  // Guards o/w/Shift+S/Shift+M — each is an async LLM-bound flow that shows
  // a spinner, awaits a real complete() call (anywhere from under a second
  // to 10+ seconds), then opens a review modal (o/w/Shift+S) or applies
  // directly (Shift+M has no review step). None of them disable their own
  // key while in flight, so an impatient repeat press (nothing visibly
  // happened yet) used to start a SECOND concurrent run — a second spinner,
  // a second LLM call, and eventually a second review modal stacking on top
  // of the first (each independently `parent: app.screen`). Closing just the
  // top one left the other still parented underneath, so anything watching
  // `app.screen.children.length` against a pre-press baseline (the
  // tutorial's own isModalOpen()) never saw it drop back down — stuck
  // waiting for a "close" that could never fully arrive. One shared flag
  // is enough since these four are mutually exclusive anyway (nothing sane
  // comes from running two of them at once regardless of which two).
  // Deliberately narrow scope for all four: released as soon as the
  // "immediate" part of the flow finishes (a review modal opening, or for
  // Shift+M, the title prompt closing) — never held through a later async
  // best-effort auto-summarize phase (merge/split both have one). An
  // earlier attempt DID hold it through that phase specifically to stop two
  // overlapping spinners from fighting over the shared toast widget
  // (app.js) — that broke legitimate immediate follow-up actions instead
  // (e.g. Shift+S right after a merge silently did nothing, confirmed by a
  // real e2e regression). The toast-hiding bug is fixed at its actual
  // source now — see app.js's startSpinner() stop(), reference-counted on
  // busyWidgets instead of hiding unconditionally.
  let asyncReviewFlowRunning = false;
  const SORT_CYCLE = ['recent', 'title', 'agent'];
  let app;
  let foldersBox, listBox, detailBox;
  let rows = [];
  // Sessions ↔ Calendar toggle (`v`). Calendar is a second full-panel screen
  // co-hosted in app.body, not a modal — see calendar.js's module doc for why
  // it's show()/hide()'d rather than swapped via app.show(). Sessions-only
  // global keys (screenKey below) must not fire while Calendar is active, or
  // e.g. `/` would silently pop the search prompt behind it.
  let activeTab = 'sessions';
  let calTab = null;

  // Attach a screen-level key without leaking across view swaps. Guarded by
  // activeTab so e.g. `/` doesn't silently pop the search prompt while the
  // Calendar tab is on screen — blessed's screen.key() listeners fire
  // unconditionally regardless of which widget is focused, unlike widget-
  // level .key() bindings. `v` itself passes alwaysActive since it's how you
  // get back from Calendar in the first place.
  function screenKey(app, keys, fn, opts = {}) {
    app.screen.key(keys, (...args) => {
      if (!opts.alwaysActive && activeTab !== 'sessions') return;
      fn(...args);
    });
  }

  function reloadFolders() {
    const { list, counts, inbox, total } = data.folders();
    // Root shows the grand total (everything, same as drilling into it) —
    // the New pseudo-folder right below it is where the old "Root = unfiled
    // only" behavior moved to, so nothing that used to be visible at Root is
    // hidden, it's just one level down under an explicit, countable name
    // instead of silently being what Root happened to show.
    const items = [`{${state.folder === undefined ? C.fox : C.dim}-fg}${t('folders.root')} (${total}){/}`];
    const keys = [undefined];
    items.push(`  {${state.folder === null ? C.fox : C.dim}-fg}${t('folders.new')} (${inbox}){/}`);
    keys.push(null);
    for (const f of list) {
      // +1: every real folder nests visually under Root, not flush with it.
      const depth = Math.min(f.split('/').length - 1, 4) + 1;
      const indent = '  '.repeat(depth);
      const leaf = f.split('/').pop();
      const on = state.folder === f;
      items.push(`${indent}{${on ? C.fox : C.dim}-fg}${leaf} (${counts.get(f)}){/}`);
      keys.push(f);
    }
    foldersBox._keys = keys;
    // A real bug: neo-blessed's List.prototype.setItems() tries to keep the
    // cursor on "the same item" across a full items replacement by matching
    // the PREVIOUSLY selected row's rendered TEXT against the new array
    // (`items.indexOf(oldRenderedText)`) — a content match, not an identity/
    // index one. Two folders sharing a leaf name under different parents
    // (e.g. cases/CW and projects/CW) render byte-identical rows whenever
    // neither is the current one (same dim color, same leaf, same count) —
    // so the instant the cursor moves onto one of them, setItems()'s own
    // heuristic can match that old identical text against the OTHER
    // same-named folder and silently relocate the cursor there instead.
    // Confirmed via a real reproduction: navigating onto cases/CW jumped the
    // real selection to projects/CW while state.folder (computed from the
    // index just before this call) still correctly said "cases/CW" — a
    // genuine desync where the highlighted "current folder" and the actual
    // cursor disagreed, and the next move/rename/delete acted on the wrong
    // one. Since reloadFolders() runs on every keystroke (previewFolder()'s
    // live preview) and every folder op's own refresh, restoring our own
    // already-correct index right after setItems() unconditionally
    // overrides that fragile guess.
    const wantIndex = foldersBox.selected;
    foldersBox.setItems(items);
    foldersBox.select(Math.min(wantIndex, items.length - 1));
  }

  // Recent is whatever order data.sessions() already returns (most-recent
  // first, or FTS relevance while searching) — left untouched. Title/agent
  // are re-sorted client-side; ties within the same agent fall back to
  // recency so agent grouping doesn't otherwise scramble chronology.
  function sortRows(list) {
    if (state.sortBy === 'title') {
      return [...list].sort((a, b) =>
        (a.title || a.summary || a.preview || '').localeCompare(b.title || b.summary || b.preview || ''),
      );
    }
    if (state.sortBy === 'agent') {
      return [...list].sort((a, b) => {
        const c = sourceLabel(a.source).localeCompare(sourceLabel(b.source));
        return c !== 0 ? c : (b.startedAt || '').localeCompare(a.startedAt || '');
      });
    }
    return list;
  }

  function reloadList() {
    rows = sortRows(data.sessions({ folder: state.folder, query: state.query, tags: state.tags }));
    const items = rows.map((r) => {
      // Agent name formatted as a hashtag, same visual language as tags —
      // and now trails the title instead of leading it, so the title (the
      // thing you're actually scanning for) reads first on the line.
      const src = `{${sourceColor(r.source)}-fg}#${sourceLabel(r.source)}{/}`;
      // Same "source #idPrefix" shape as the continuation links in detail
      // ("Continues:"/"Continued by:"), so you can match a row here to that
      // label there.
      const idPrefix = `{${C.dim}-fg}#${r.id.slice(0, 8)}{/}`;
      // No reserved gutter — the checkmark only takes space on rows you've
      // actually selected, so the title starts flush-left the rest of the
      // time instead of every row paying for a feature most rows don't use.
      const mark = state.selected.has(r.id) ? `{${C.fox}-fg}✓{/} ` : '';
      // Continuation markers moved into the right-hand metadata cluster —
      // they're relationship metadata about the row, same category as
      // agent/id, not something that belongs competing for the left edge.
      // Bracketed text tags, same visual language as isNew's [New] below —
      // no emoji for state/relationship markers anywhere in this codebase.
      const link = r.continuationOf
        ? `{${C.spore}-fg}[${t('sessions.resumedBadge')}]{/} `
        : r.continuedTo && r.continuedTo.length
          ? `{${C.spore}-fg}[${t('sessions.handoffBadge')}]{/} `
          : '';
      // Same marker language, different tag: merge product, split piece, or
      // a session with related derived content elsewhere — supersededBy
      // (merge original — hidden by default, so this case is mostly
      // unreachable in practice) or splitInto (split original, which DOES
      // stay visible, unlike a merge original, since none of its content
      // actually moved anywhere).
      const lineage = r.mergedFrom?.length
        ? `{${C.merged}-fg}[${t('sessions.mergedBadge')}]{/} `
        : r.splitFrom
          ? `{${C.merged}-fg}[${t('sessions.splitBadge')}]{/} `
          : r.supersededBy?.length || r.splitInto?.length
            ? `{${C.faint}-fg}[${t('sessions.linkedBadge')}]{/} `
            : '';
      const isNew = !r.folder ? `{${C.spore}-fg}[${t('sessions.newBadge')}]{/}` : '';
      // Under active search, lead with the FTS snippet — the row's row-reason.
      // The default preview (first user message) hides matches deep in the
      // conversation, which looked like false positives.
      const base = r.snippet
        ? `${r.title ? r.title + ' — ' : ''}${r.snippet}`
        : r.title || r.summary || r.preview || t('common.noContent');
      const text = base.replace(/\s+/g, ' ').slice(0, 58);
      // {|} is blessed's right-align pivot (same trick app.js uses for the
      // header) — pins the metadata cluster to the column's right edge
      // instead of trailing directly off the title text.
      return `${mark}${text}{|}${lineage}${link}${src} ${idPrefix} ${isNew}`;
    });
    listBox.setItems(items.length ? items : [`{gray-fg}${t('sessions.empty')}{/}`]);
    updateHeader();
  }

  function updateHeader() {
    // state.folder is falsy for both Root (undefined) and New (null) — the
    // generic `|| t('folders.root')` fallback below would label New as Root
    // too, so catch it explicitly first.
    const crumb = state.folder === null ? t('folders.new') : state.folder || t('folders.root');
    const filt = [state.query && `/${state.query}`, ...state.tags.map((tg) => `#${tg}`)].filter(Boolean).join(' ');
    const sortSuffix = state.sortBy === 'recent' ? '' : `  {${C.dim}-fg}${t('sessions.sortLabel_' + state.sortBy)}{/}`;
    app.setHeader(`${crumb}${filt ? '  {' + C.spore + '-fg}' + filt + '{/}' : ''}`, `${rows.length} sessions${sortSuffix}`);
  }

  function showDetail(id) {
    const n = data.detail(id);
    if (!n) return;
    detailBox.setContent(formatSessionDetail(n).join('\n'));
    detailBox.setScroll(0);
    app.render();
  }

  // Callers only ever called showDetail(rows[0].id) when a row existed,
  // leaving whatever the panel last showed (e.g. a since-deleted tutorial
  // mock session) on screen once a folder/list goes empty instead.
  function clearDetail() {
    detailBox.setContent('');
    detailBox.setScroll(0);
  }

  function currentRow() {
    return rows[listBox.selected];
  }

  return {
    async mount(a) {
      app = a;
      // Three columns side by side: Folders | Sessions | Detail. The focused
      // column widens so space isn't wasted (k9s feel); the others stay compact.
      foldersBox = blessed.list({
        parent: app.body,
        top: 0,
        left: 0,
        width: '22%',
        bottom: 0,
        label: t('sessions.foldersPanelLabel'),
        tags: true,
        keys: true,
        padding: { left: 1, right: 1 },
        scrollbar: { ch: ' ', style: { bg: C.border } },
        border: { type: 'line' },
        style: { border: { fg: C.border }, selected: { bg: C.surface, fg: C.fox }, fg: C.dim, focus: { border: { fg: C.fox } } },
      });
      listBox = blessed.list({
        parent: app.body,
        top: 0,
        left: '22%',
        width: '38%',
        bottom: 0,
        label: t('sessions.sessionsPanelLabel'),
        tags: true,
        keys: true,
        padding: { left: 1, right: 1 },
        scrollbar: { ch: ' ', style: { bg: C.border } },
        border: { type: 'line' },
        style: { border: { fg: C.border }, selected: { bg: C.surface, fg: C.text }, fg: C.dim, focus: { border: { fg: C.fox } } },
      });
      detailBox = blessed.box({
        parent: app.body,
        top: 0,
        left: '60%',
        right: 0,
        bottom: 0,
        label: t('sessions.detailPanelLabel'),
        tags: true,
        scrollable: true,
        alwaysScroll: true,
        keys: true,
        mouse: true,
        padding: { left: 1, right: 1 },
        scrollbar: { ch: ' ', style: { bg: C.border } },
        border: { type: 'line' },
        style: { border: { fg: C.border }, fg: C.text, focus: { border: { fg: C.fox } } },
      });

      reloadFolders();
      reloadList();

      // Each column's fraction is of the FULL width, not "whatever's left
      // after folders" — the old scheme capped folders at a fixed ~18-30
      // columns no matter what, so it never actually grew when focused, and
      // folder names (especially Korean, double-width per character) got cut
      // off. Now the focused column gets meaningfully more room and the
      // other two shrink to a still-readable minimum.
      const LAYOUT_FRACS = {
        folders: { folders: 0.3, sessions: 0.32 }, // detail gets the rest (~38%)
        sessions: { folders: 0.16, sessions: 0.48 }, // detail gets the rest (~36%)
        detail: { folders: 0.14, sessions: 0.26 }, // detail gets the rest (~60%)
      };
      const applyLayout = (lvl) => {
        const W = app.screen.width || 120;
        const fracs = LAYOUT_FRACS[lvl] || LAYOUT_FRACS.folders;
        const foldersW = Math.max(18, Math.round(W * fracs.folders));
        const sessionsW = Math.max(22, Math.round(W * fracs.sessions));
        foldersBox.left = 0;
        foldersBox.width = foldersW;
        listBox.left = foldersW;
        listBox.width = sessionsW;
        detailBox.left = foldersW + sessionsW;
        detailBox.width = null; // right:0 lets detail fill the remainder
      };
      app.screen.on('resize', () => {
        applyLayout(state.level || 'folders');
        app.render();
      });

      // ── k9s-style drill-down: Folders → Sessions → Detail, Enter=in, Esc=out ──
      // Status bar shows the short Context Flywheel loop (Capture·s →
      // Organize·o → Learn·k → Reuse·n) instead of per-level nav hints or
      // the full stage-by-stage breakdown — no free row anywhere on screen
      // to show more than this,
      // and the detailed version now lives in the ? modal (help.text) where
      // someone can actually read it once instead of relearning the whole
      // model from a permanent status line on every screen. Factored out of
      // setLevel() so reloadAll() can also refresh it — the status bar is
      // otherwise only re-set on a level change, so it stayed in whatever
      // language was active at mount time even after a later setLocale()
      // call (e.g. index.js's language picker, which mounts the view
      // BEFORE the human has actually picked a language, deliberately, so
      // the persona picker shown right after has real chrome behind it —
      // see index.js's pickLanguage()).
      const updateStatusBar = () => {
        app.setStatus(' ' + t('lifecycle.bar', C.text) + '    ' + t('status.helpFallback'));
      };
      // Same staleness problem as updateStatusBar() above, same fix shape —
      // these three border labels are blessed widget CONSTRUCTION options
      // (`label: t(...)` passed to blessed.list()/blessed.box() once, at
      // mount time), not something re-applied on every render the way row
      // content is. A setLocale() call after mount (index.js's language
      // picker, deliberately mounted before the human has picked a
      // language) left them stuck in whatever was active at mount time.
      const updatePanelLabels = () => {
        foldersBox.setLabel(t('sessions.foldersPanelLabel'));
        listBox.setLabel(t('sessions.sessionsPanelLabel'));
        detailBox.setLabel(t('sessions.detailPanelLabel'));
      };
      const setLevel = (lvl) => {
        state.level = lvl;
        applyLayout(lvl);
        updateStatusBar();
      };

      // Back from the Calendar tab: re-show Sessions' own panels and restore
      // whatever header/status/focus they had before `v` switched away —
      // state.folder/query/tags were never touched, so the list is exactly
      // as it was.
      const showSessionsTab = () => {
        if (calTab) calTab.deactivate();
        activeTab = 'sessions';
        foldersBox.show();
        listBox.show();
        detailBox.show();
        updateHeader();
        setLevel(state.level || 'folders');
        const focusBox = state.level === 'detail' ? detailBox : state.level === 'sessions' ? listBox : foldersBox;
        focusBox.focus();
        app.render();
      };

      // Live-preview the highlighted folder's sessions as you move (no drill yet).
      const previewFolder = () => {
        state.folder = foldersBox._keys[foldersBox.selected];
        reloadFolders();
        reloadList();
        if (rows[0]) showDetail(rows[0].id);
        else clearDetail();
        app.render();
      };
      foldersBox.on('keypress', (ch, key) => {
        if (key && ['up', 'down', 'k', 'j', 'pageup', 'pagedown', 'home', 'end', 'g'].includes(key.name)) {
          setImmediate(previewFolder);
        }
      });
      // Enter a folder → drill into its sessions. Right arrow mirrors Enter
      // so the three columns can be walked with just the arrow keys.
      const drillIntoSessions = () => {
        previewFolder(); // already shows/clears detail for rows[0]
        listBox.focus();
        listBox.select(0);
        setLevel('sessions');
        app.render();
      };
      foldersBox.key('enter', drillIntoSessions);
      foldersBox.key('right', drillIntoSessions);

      // ── Folder management (only when the folders pane is focused) ──
      const curFolder = () => foldersBox._keys[foldersBox.selected];
      // The two non-real entries in this panel are Root (key: undefined) and
      // the New pseudo-folder (key: null) — both falsy, so this one check
      // already keeps rename/move/delete/knowledge-extract off both without
      // needing to know about either sentinel specifically.
      const isRealFolder = (f) => !!f;
      // `affectedIds`: only rename/move/delete-folder actually touch session
      // records (rewriting `folder`) — pass the exact ids so this stays O(k)
      // instead of reindex()'s full raw/ rebuild. Plain folder creation
      // touches zero sessions, so it's fine (and correct) to pass none.
      const refreshFolders = (selectPath, affectedIds) => {
        state.selected.clear();
        if (affectedIds && affectedIds.length) data.refreshMany(affectedIds);
        reloadFolders();
        // try to keep the cursor on a sensible folder
        if (selectPath) {
          const idx = foldersBox._keys.indexOf(selectPath);
          if (idx >= 0) foldersBox.select(idx);
        }
        previewFolder();
        foldersBox.focus();
        app.render();
      };

      // a: new subfolder under the selected folder (or root).
      foldersBox.key('a', () => {
        const parent = isRealFolder(curFolder()) ? curFolder() : '';
        prompt(app, t('folders.newPrompt', parent), '', (name) => {
          foldersBox.focus();
          if (!name || !name.trim()) return;
          const path = (parent ? parent + '/' : '') + name.trim().replace(/^\/+|\/+$/g, '');
          mkdir(path);
          app.notify(t('folders.created', path));
          refreshFolders(path);
        });
      });

      // e: rename the selected folder.
      foldersBox.key('e', () => {
        const f = curFolder();
        if (!isRealFolder(f)) return app.notify(t('folders.cannotRenameRoot'), 3);
        prompt(app, t('folders.renamePrompt', f), f, (val) => {
          foldersBox.focus();
          if (!val || val.trim() === f) return;
          const res = renameFolder(f, val.trim().replace(/^\/+|\/+$/g, ''));
          app.notify(res.ok ? t('folders.renamed', res.to) : res.error, res.ok ? 2 : 3);
          refreshFolders(res.ok ? res.to : f, res.ok ? res.affected.map((n) => n.id) : []);
        });
      });

      // m: move (re-nest) the selected folder into another folder.
      foldersBox.key('m', () => {
        const f = curFolder();
        if (!isRealFolder(f)) return app.notify(t('folders.cannotMoveRoot'), 3);
        pickFolder(app, (dest) => {
          foldersBox.focus();
          if (dest === undefined) return;
          const target = (dest ? dest + '/' : '') + basename(f);
          const res = renameFolder(f, target);
          app.notify(res.ok ? t('folders.movedTo', res.to) : res.error, res.ok ? 2 : 3);
          refreshFolders(res.ok ? res.to : f, res.ok ? res.affected.map((n) => n.id) : []);
        });
      });

      // x: delete the selected folder (sessions → unfiled, shown under New).
      foldersBox.key('x', () => {
        const f = curFolder();
        if (!isRealFolder(f)) return app.notify(t('folders.cannotDeleteRoot'), 3);
        menu(
          app,
          t('folders.deleteConfirmTitle', f),
          [
            { label: t('folders.deleteConfirmYes', t('folders.new')), value: 'yes' },
            { label: t('common.cancel'), value: 'no' },
          ],
          (ans) => {
            foldersBox.focus();
            if (ans !== 'yes') return;
            const res = deleteFolder(f);
            app.notify(res.ok ? t('folders.deleted', res.moved) : res.error);
            state.folder = undefined;
            refreshFolders(undefined, res.ok ? res.affected.map((n) => n.id) : []);
          },
        );
      });

      // Session navigation previews detail; Enter opens detail; Esc goes back.
      listBox.on('keypress', (ch, key) => {
        if (key && ['up', 'down', 'k', 'j', 'pageup', 'pagedown', 'home', 'end', 'g'].includes(key.name)) {
          setImmediate(() => {
            const r = currentRow();
            if (r) showDetail(r.id);
          });
        }
      });
      const drillIntoDetail = () => {
        detailBox.focus();
        setLevel('detail');
        app.render();
      };
      const backToFolders = () => {
        foldersBox.focus();
        setLevel('folders');
        app.render();
      };
      const backToSessions = () => {
        listBox.focus();
        setLevel('sessions');
        app.render();
      };
      listBox.key('enter', drillIntoDetail);
      listBox.key('right', drillIntoDetail);
      listBox.key('escape', backToFolders);
      listBox.key('left', backToFolders);
      detailBox.key(['escape'], backToSessions);
      detailBox.key(['left'], backToSessions);

      // Multi-select toggle.
      listBox.key('space', () => {
        const r = currentRow();
        if (!r) return;
        if (state.selected.has(r.id)) state.selected.delete(r.id);
        else state.selected.add(r.id);
        reloadList();
        app.render();
      });

      // Shift+O: cycle sort order — recent (default) → title A-Z → agent.
      // Client-side only (sortRows() above), doesn't touch the index —
      // "recent" is already how data.sessions()/search() order rows.
      listBox.key('S-o', () => {
        const i = SORT_CYCLE.indexOf(state.sortBy);
        state.sortBy = SORT_CYCLE[(i + 1) % SORT_CYCLE.length];
        reloadList();
        app.render();
      });

      // *: select every session currently listed (this folder/search scope,
      // not the whole store) — toggles off if everything's already selected.
      listBox.key('*', () => {
        if (!rows.length) return;
        const allSelected = rows.every((r) => state.selected.has(r.id));
        for (const r of rows) {
          if (allSelected) state.selected.delete(r.id);
          else state.selected.add(r.id);
        }
        reloadList();
        app.render();
      });

      // Shift+M: merge the multi-selected sessions into one new synthetic
      // session — git-like (mergeSessions() never rewrites the originals'
      // turns, just supersedes them; fully reversible via `mycelium
      // unmerge`). Blessed reports Shift+letter as 'S-<letter>', not the
      // literal uppercase character (confirmed in neo-blessed's program.js).
      //
      // Same key also REVERTS, when there's nothing to merge in the first
      // place: 0 or 1 target (selected, or just the row under the cursor if
      // nothing's selected) that turns out to BE a merge product. unmerge()/
      // unsplit() were previously CLI-only — `mycelium unmerge <id>` — which
      // meant actually reverting meant leaving the TUI, even though the toast
      // (merge.done below) has told you the command exists since it was
      // added. Doesn't touch the "merge 2+ selected" path at all: this only
      // fires when that path wouldn't have had enough targets anyway.
      const doUnmerge = (id) => {
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
      };
      listBox.key('S-m', () => {
        const ids = [...state.selected];
        if (ids.length <= 1) {
          const targetId = ids[0] ?? currentRow()?.id;
          if (targetId && doUnmerge(targetId)) return;
        }
        if (ids.length < 2) return app.notify(t('merge.needsTwo'), 3);
        // See asyncReviewFlowRunning's own comment (near `state`'s
        // declaration) — only guards the title prompt itself (a second
        // Shift+M while it's open), released the instant it closes, same
        // scope as o/w/Shift+S's own guards. Deliberately NOT held through
        // the async auto-summarize below — the UI (and the very next
        // keypress, e.g. Shift+S right after a merge) is meant to be usable
        // immediately once the merge itself has applied, summary filling in
        // independently in the background; a prior attempt at holding the
        // guard through that whole phase broke exactly this (confirmed by a
        // real e2e regression — merge-then-immediate-split silently did
        // nothing, split's own key press swallowed by the still-held
        // guard). The toast-hiding bug this was meant to prevent is fixed
        // at its actual source instead — see app.js's startSpinner()
        // stop(), gated on busyWidgets instead of hiding unconditionally.
        if (asyncReviewFlowRunning) return;
        asyncReviewFlowRunning = true;
        textPrompt(app, t('merge.titlePrompt'), suggestMergeTitle(ids), async (title) => {
          asyncReviewFlowRunning = false;
          if (title === null) return listBox.focus(); // Esc — cancelled
          const res = mergeSessions(ids, { title: title.trim() || undefined });
          if (!res.ok) return app.notify(res.error, 3);
          state.selected.clear();
          data.refreshMany([res.merged.id, ...ids]);
          reloadFolders();
          reloadList();
          // Restore focus/render synchronously, before the async
          // auto-summarize below — textPrompt's own blessed.prompt takes
          // focus while open and doesn't hand it back on its own once
          // destroyed, so leaving this until after an awaited LLM call
          // left listBox unfocused (and therefore deaf to the very next
          // keypress, e.g. Shift+S right after a merge) for however long
          // that call took.
          listBox.focus();
          app.render();
          // Real title/summary/tags for the merged result, same LLM call `a`
          // uses — without this, mergeSessions() alone leaves summary empty
          // (and title empty too, unless typed above) until a separate
          // manual `a`, which read as "merge produces a broken/empty
          // session." Best-effort: a failed call here doesn't undo the
          // merge that already happened, just leaves it for a later manual
          // `a` — same degrade-gracefully shape autoTagSession() already
          // has everywhere else it's called. Runs AFTER the UI has already
          // recovered — the merged session shows up immediately (title
          // blank unless typed above), summary fills in a moment later.
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
      });

      // Shift+S: LLM-suggested split — propose topic boundaries, human
      // reviews via the same multiSelectList pattern smart-organize (`o`)
      // uses, apply only the checked ranges (unchecked ranges simply stay
      // part of the original — nothing is lost either way).
      const doSplit = async () => {
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
        // See asyncReviewFlowRunning's own comment (near `state`'s
        // declaration) — an impatient repeat press while the LLM call is
        // still in flight used to start a second concurrent run: a second
        // spinner, a second suggestSplitBoundaries() call, and eventually a
        // second review modal stacking on top of the first. Closing just the
        // top one left the other still parented to app.screen underneath,
        // so anything watching screen.children.length against a pre-press
        // baseline (the tutorial's own isModalOpen()) never saw it drop back
        // down — stuck waiting for a "close" that could never fully arrive.
        if (asyncReviewFlowRunning) return;
        asyncReviewFlowRunning = true;
        const spin = app.startSpinner(t('split.suggesting'));
        const res = await suggestSplitBoundaries(r.id);
        spin.stop();
        if (!res.ok) {
          asyncReviewFlowRunning = false;
          return app.notify(res.error, 3);
        }
        const items = res.ranges.map((rg) => ({ label: t('split.turnRangeLabel', rg.from, rg.to, rg.label), value: rg }));
        // defaultAll: true — same as smart-organize's placement review.
        // Without it, a bare Enter (the obvious first thing to try) checked
        // nothing, applied nothing, and closed the modal with zero
        // feedback — indistinguishable from the keypress just not
        // registering. The LLM already proposed these ranges; reviewing
        // them is "uncheck the wrong one," not "check the right ones",
        // same reasoning organize's own review already uses.
        // Guard is released the instant this modal actually opens (not only
        // once its callback later fires) — same scope as `o`/`w`'s guards,
        // which release once their own review modal opens rather than
        // staying held through however long the human takes to review it.
        asyncReviewFlowRunning = false;
        multiSelectList(app, t('split.reviewTitle'), items, async (chosen) => {
          if (!chosen?.length) return; // Esc or everything unchecked — original untouched
          const applied = applySplit(r.id, chosen);
          if (!applied.ok) return app.notify(applied.error, 3);
          data.refreshMany([r.id, ...applied.pieces.map((p) => p.id)]);
          reloadFolders();
          reloadList();
          // Restore focus/render synchronously, before the async
          // auto-summarize below — same reasoning as the merge handler
          // above: multiSelectList's own review box takes focus while
          // open, and leaving this until after an awaited LLM call left
          // listBox unfocused for however long that took.
          listBox.focus();
          app.render();
          // Real summary/tags for each piece, same LLM call `a` uses —
          // applySplit() alone leaves summary empty on every piece (title
          // is already real, from the boundary label, and locked above so
          // this doesn't replace it). Concurrency bounded the same way
          // organize.js's summarizeCandidates()/suggestPlacements() already
          // are — a split with several ranges shouldn't fire that many LLM
          // subprocesses all at once (see issue #3). Best-effort per piece:
          // one failing doesn't undo the split or block the others. Runs
          // AFTER the UI has already recovered — pieces show up immediately
          // (with their real boundary-label titles), summaries fill in a
          // moment later. Deliberately NOT re-arming asyncReviewFlowRunning
          // here (a prior attempt did, to guard against this overlapping a
          // second trigger's own spinner on the same shared toast) — that
          // blocked legitimate immediate follow-up actions (e.g. another
          // Shift+S right after this one), confirmed by a real e2e
          // regression. The toast-hiding bug is fixed at its actual source
          // instead — see app.js's startSpinner() stop(), gated on
          // busyWidgets instead of hiding unconditionally.
          const spin = app.startSpinner(t('split.summarizing'));
          try {
            await mapConcurrent(applied.pieces, 2, (p) => autoTagSession(p.id).catch(() => {}));
          } finally {
            spin.stop();
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
      };
      listBox.key('S-s', doSplit);
      detailBox.key('S-s', doSplit);

      // Live search.
      screenKey(app, ['/'], () => {
        prompt(app, t('common.searchPrompt'), state.query, (val) => {
          state.query = (val || '').trim();
          reloadList();
          listBox.focus();
          app.render();
        });
      });

      // v: toggle to the Calendar tab (a second full-panel screen, not a
      // modal — see calendar.js). Doesn't touch state.folder/query/tags at
      // all, so coming back leaves Sessions exactly as it was. Must stay
      // active even while Calendar is focused (that's how `v` gets back),
      // hence alwaysActive on an otherwise-guarded screenKey.
      screenKey(
        app,
        ['v'],
        () => {
          if (activeTab === 'calendar') {
            showSessionsTab();
            return;
          }
          foldersBox.hide();
          listBox.hide();
          detailBox.hide();
          activeTab = 'calendar';
          if (!calTab) calTab = createCalendarTab(app, { onBack: showSessionsTab });
          calTab.activate();
        },
        { alwaysActive: true },
      );

      // s: scan only (capture new/changed sessions from every tab/terminal +
      // reindex), without leaving the TUI. Mirrors `mycelium scan`. Captured
      // sessions land unfiled — use `o` (or `mycelium organize`) to place them.
      screenKey(app, ['s'], () => {
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
        });
      });

      // o: smart organize — LLM content-based folder suggestions, comparing
      // candidates against the sessions already filed in each folder (see
      // organize.js's suggestPlacements()). Computing FRESH candidates is
      // scoped to wherever you're currently browsing (state.folder — Root =
      // everything, New = only genuinely-unfiled, a folder = itself +
      // subtree), same three-way semantics data.sessions() already uses —
      // so reviewing "this folder" doesn't drag in the whole store unless
      // you're actually standing at Root. Always a preview-then-confirm flow
      // (like w/i), and never run automatically by the daemon — unlike `s`'s
      // plain scan, this makes real LLM calls and moves things.
      screenKey(app, ['o'], async () => {
        // See asyncReviewFlowRunning's own comment above — an impatient
        // repeat press while the LLM call is still in flight used to start
        // a second concurrent run.
        if (asyncReviewFlowRunning) return;
        asyncReviewFlowRunning = true;
        try {
          await runSmartOrganize();
        } finally {
          asyncReviewFlowRunning = false;
        }
      });
      async function runSmartOrganize() {
        // Reuse whatever the daemon already queued (see organize.js's
        // smartOrganizeCycle) instead of recomputing — makes `o` instant when
        // the daemon's been doing the work in the background. Deliberately
        // UNSCOPED (not filtered to state.folder) — this is already-computed
        // work, not a fresh classification run, so there's no reason to
        // throw it away just because you're not standing in the matching
        // folder right now. Scoping this too was an earlier attempt that
        // backfired: pressing `o` outside the exact folder silently ignored
        // a real pending suggestion and fell through to recomputing it from
        // scratch (a wasted LLM call for something already sitting there).
        let matches = pendingSuggestions();
        if (!matches.length) {
          // Only summarizes the sessions actually being classified below —
          // not the whole store's summary backlog. Calls the LLM once per
          // such session lacking one (in bounded concurrent chunks, see
          // organize.js). startSpinner() (app.js) both animates the wait and
          // — since it re-displays on its own 120ms timer, independent of
          // how often onProgress actually fires — keeps the toast alive even
          // if every concurrent lane happens to be stalled on a slow call at
          // once; the old plain notify() could expire mid-batch and make a
          // still-running classification look hung.
          const pending = classificationCandidates({ cooldownMs: 0, folder: state.folder }).filter(
            (n) => !n.extracted.summary,
          ).length;
          // Real progress bars, not the animated-but-fake spinner — both
          // phases already know a true total up front (pending count,
          // chunk count), which is exactly what startProgressBar() is for
          // (see app.js). A large first scan can mean minutes of real work
          // here, so a filling bar sets honest expectations instead of
          // looking hung.
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

      // k: knowledge review — mirrors o's own shape exactly (reuse whatever
      // the daemon already queued overnight if present, else compute fresh
      // right now) rather than nesting inside Digest (`d`), a deliberately
      // separate, unrelated feature. This is the expected, primary way a
      // human reviews/approves a day's KNOWLEDGE.md refreshes; the daemon's
      // independent knowledgeReviewCycle (daemon/cycles.js) is only the
      // fallback for whenever a human didn't get to it — both call the same
      // insight.js proposeKnowledgeRefreshes(), so either path produces an
      // identical result.
      screenKey(app, ['k'], async () => {
        if (asyncReviewFlowRunning) return;
        asyncReviewFlowRunning = true;
        try {
          await runKnowledgeReview();
        } finally {
          asyncReviewFlowRunning = false;
        }
      });
      async function runKnowledgeReview() {
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
          applyKnowledgeApprovals(toPromote);
        }, {
          defaultAll: true,
          // Full-content review before approving — the one-line label
          // snippet isn't enough to actually judge what's about to land in
          // KNOWLEDGE.md (and from there, some real project's AGENTS.md).
          previewText: (folder) => pending.find((p) => p.folder === folder)?.text || '',
        });
      }

      // Approving the KNOWLEDGE.md content is one decision; which real
      // project directories actually get it is a separate one — a folder
      // can span several directories a session merely happened to run in
      // (e.g. a quick "what is X" question asked from an unrelated repo's
      // terminal, content-classified into a real project folder), and
      // dirsForFolder() has no way to tell "the project" from "somewhere a
      // session incidentally ran". Auto-injecting into all of them
      // regardless — the original behavior — silently wrote into
      // directories that had nothing to do with the actual project. `n`'s
      // own directory picker already lets a human choose from exactly
      // these candidates instead of guessing; this mirrors that: 0 or 1
      // directory (no ambiguity) injects straight through same as before,
      // 2+ shows a checklist (all pre-checked, same trust level as the
      // knowledge approval itself) so a stray directory can be unchecked.
      function applyKnowledgeApprovals(toPromote) {
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

      // ?: full keymap reference — status bar only shows a short breadcrumb now.
      screenKey(app, ['?'], () => helpModal(app));

      // g: re-show the first-run getting-started guide on demand — index.js
      // only shows it automatically once (config.json's `onboarded` flag),
      // this is how to pull it back up any time after that.
      screenKey(app, ['g'], () => welcomeModal(app));

      // Which sessions an action targets: the multi-selection if any, else the row under the cursor.
      const targets = () => (state.selected.size ? [...state.selected] : currentRow() ? [currentRow().id] : []);

      // `ids` are exactly what changed — refreshMany() upserts each (or drops
      // it from the index if the raw file's gone, i.e. a delete) instead of
      // reindex()'s full raw/ reparse + FTS rebuild for every mutation.
      const afterMutate = (ids) => {
        state.selected.clear();
        data.refreshMany(ids);
        reloadFolders();
        reloadList();
        app.render();
      };

      // Organize: move to folder.
      listBox.key('m', () => {
        const ids = targets();
        if (!ids.length) return;
        pickFolder(app, (folder) => {
          if (folder === undefined) return listBox.focus();
          for (const id of ids) organizeMove(id, folder);
          app.notify(t('sessions.movedTo', ids.length, folder || t('sessions.newBadge')));
          afterMutate(ids);
          listBox.focus();
        });
      });

      // Organize: edit tags.
      listBox.key('t', () => {
        const ids = targets();
        if (!ids.length) return;
        const cur = ids.length === 1 ? data.detail(ids[0])?.extracted.tags || [] : [];
        editTags(app, cur, (edit) => {
          if (!edit) return listBox.focus();
          for (const id of ids) organizeTag(id, edit.add, edit.remove);
          app.notify(t('sessions.tagsUpdated', ids.length));
          afterMutate(ids);
          listBox.focus();
        });
      });

      // Organize: delete (Mycelium's own record only — original agent log
      // untouched; the id is excluded so a rescan won't re-import it). Works
      // on the multi-selection if any, else the current row.
      const doDelete = () => {
        const ids = targets();
        if (!ids.length) return;
        menu(
          app,
          t('sessions.deleteConfirmTitle', ids.length),
          [
            { label: t('common.delete'), value: 'yes' },
            { label: t('common.cancel'), value: 'no' },
          ],
          (ans) => {
            if (ans !== 'yes') return listBox.focus();
            const touched = new Set(ids);
            for (const id of ids) for (const otherId of deleteSession(id).touchedIds || []) touched.add(otherId);
            app.notify(t('sessions.deleted', ids.length));
            afterMutate([...touched]);
            listBox.focus();
            setLevel('sessions');
          },
        );
      };
      listBox.key('x', doDelete);
      detailBox.key('x', doDelete);

      // Capture: launch a new agent session in the current folder's context.
      // Once an agent/directory are picked, launchAgent() (launch.js) itself
      // asks "open here or copy command (new tab)" — same choice
      // resume-handoff.js's onDetailEnter offers for an existing session.
      // "Copy command" doesn't actually capture anything here (no real
      // launch, no scan()), so reloadFolders()/reloadList() below are a
      // harmless no-op refresh in that case, not a bug.
      listBox.key('n', () => {
        // launchAgent() (launch.js) already reindexes exactly what scan()
        // captured internally — no need to also reindex the whole store here.
        launchAgent(app, { folder: state.folder }, () => {
          reloadFolders();
          reloadList();
          listBox.focus();
          app.render();
        });
      });

      // Resume/handoff/copy-command trio — shared with the Calendar tab's
      // day-list/detail (see resume-handoff.js). Only the "what's currently
      // selected" accessor and the post-action callbacks are view-specific.
      const { doResume, doHandoff, onDetailEnter } = createResumeHandoff(app, {
        getCurrentRow: currentRow,
        afterResume: () => {
          reloadFolders();
          reloadList();
          listBox.focus();
          setLevel('sessions');
          app.render();
        },
        afterHandoff: () => {
          reloadFolders();
          reloadList();
          listBox.focus();
          app.render();
        },
      });
      listBox.key('h', () => doHandoff());
      listBox.key('r', doResume);
      detailBox.key('enter', onDetailEnter);

      // Learn: generate summary + tags (content-based). Works on the multi-
      // selection if any, else the current row. This is how a session gets its
      // summary — the LLM reads the session and writes the task summary + tags.
      // Runs up to 3 at once via mapConcurrent() (llm.js) instead of one at a
      // time — same bounded-concurrency pattern organize.js's
      // summarizeCandidates()/suggestPlacements() and learn.js's tagAll()
      // use, so this (the most directly felt slow path — a human watching a
      // progress toast crawl through a multi-select) gets the same speedup.
      // The progress toast now advances on each COMPLETION rather than each
      // start, since completion order no longer matches selection order.
      const doAutoTag = async () => {
        const ids = state.selected.size ? [...state.selected] : currentRow() ? [currentRow().id] : [];
        if (!ids.length) return;
        let done = 0;
        let failed = 0;
        let lastError = null;
        // startSpinner() (app.js) keeps this alive and animated for however
        // long the whole batch actually takes — a plain notify(msg, 90)
        // could expire mid-batch if every concurrent lane happened to be on
        // a slow call at once, well before 3 of 3 concurrent selections
        // simultaneously stalling was actually unlikely, but a real
        // possibility on a slow connection.
        const spin = app.startSpinner(t('sessions.summarizing', 0, ids.length));
        await mapConcurrent(ids, 3, async (id) => {
          try {
            const res = await autoTagSession(id);
            if (res.ok) done++;
            else {
              failed++;
              lastError = res.error;
            }
          } catch (err) {
            // Defense in depth: autoTagSession() now catches its own LLM
            // call, but anything else unexpected (disk write, etc.) still
            // shouldn't kill the rest of a multi-select batch.
            failed++;
            lastError = err.message;
          }
          spin.update(t('sessions.summarizing', done + failed, ids.length));
          // Only `id` changed this iteration — a full reindex() here would
          // reparse the whole raw/ store once per selected session (an N×
          // full-store rebuild for an N-session multi-select autotag).
          data.refreshOne(id);
          reloadList();
          if (currentRow() && currentRow().id === id) showDetail(id);
        });
        spin.stop();
        state.selected.clear();
        reloadList();
        app.notify(t('sessions.summarizeDone', done, failed, lastError), failed ? 6 : 3);
      };
      listBox.key('a', doAutoTag);
      detailBox.key('a', doAutoTag);

      // e: rename the title only (Mycelium's own record only — never the
      // original agent's log). Summary/tags/decisions/todos stay purely
      // AI-generated — a later auto-tag (a) still refreshes them, but never
      // touches a title that's already been set (see learn.js).
      const doEditTitle = () => {
        const r = currentRow();
        if (!r) return;
        const n = data.detail(r.id);
        textPrompt(app, t('editor.titlePrompt'), n?.extracted.title || '', (val) => {
          if (val === null) return; // Esc — cancelled
          const res = setContent(r.id, { title: val });
          app.notify(res.ok ? t('editor.saved') : t('editor.saveFailed', res.error), res.ok ? 2 : 3);
          data.refreshOne(r.id);
          reloadFolders();
          reloadList();
          if (currentRow() && currentRow().id === r.id) showDetail(r.id);
          app.render();
        });
      };
      listBox.key('e', doEditTitle);
      detailBox.key('e', doEditTitle);

      // Copy the current session (title + summary + full transcript) to clipboard.
      const doCopy = () => {
        const r = currentRow();
        if (!r) return;
        const n = data.detail(r.id);
        if (!n) return;
        const ok = copyToClipboard(sessionToText(n));
        app.notify(ok ? t('sessions.copied') : t('sessions.copyFailed'), ok ? 2 : 3);
      };
      listBox.key('y', doCopy);
      detailBox.key('y', doCopy);

      // w: extract KNOWLEDGE.md for the current folder — generate, show the
      // human what it's about to write (it feeds AGENTS.md for every future
      // session in this folder), and only save on explicit confirm.
      const doKnowledge = async () => {
        if (!state.folder) return app.notify(t('folders.selectFirst'), 3);
        // See asyncReviewFlowRunning's own comment (near `state`'s
        // declaration) — an impatient repeat press while the LLM call is
        // still in flight used to start a second concurrent run.
        if (asyncReviewFlowRunning) return;
        asyncReviewFlowRunning = true;
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
          asyncReviewFlowRunning = false;
        }
      };
      listBox.key('w', doKnowledge);
      foldersBox.key('w', doKnowledge);

      // d: digest viewer (browse existing; generate new from inside via n/w).
      screenKey(app, ['d'], () => digestReader(app));
      // c: preview inherited context for the current folder scope — same
      // state.folder + dual-panel binding as w (doKnowledge) above, not
      // currentRow().folder. Binding this on listBox only used to mean
      // pressing c right after returning to the Folders panel (← — the
      // exact key the previous tutorial step teaches) did nothing at all,
      // leaving nothing for the tutorial's isModalOpen() poll to ever
      // detect — found by walking the tutorial live in tmux, not from
      // reading this handler in isolation.
      const doContext = () => {
        if (!state.folder) return app.notify(t('folders.selectFirst'), 3);
        const ctx = assembleContext(state.folder);
        textView(app, t('context.title', state.folder), ctx || t('context.empty'), ['c']);
      };
      listBox.key('c', doContext);
      foldersBox.key('c', doContext);
      // i: inject the folder's KNOWLEDGE.md into a directory's AGENTS.md —
      // show exactly what will be written before touching that file.
      // i: inject the current folder scope's KNOWLEDGE.md into a directory's
      // AGENTS.md. Same state.folder + dual-panel binding as w/c above, not
      // currentRow().folder — for the same reason: c's list-only binding
      // left the tutorial's Reuse step stuck if the human had just pressed
      // ← back to Folders (which the step right before it teaches), and i
      // had the identical bug.
      const doInject = () => {
        if (!state.folder) return app.notify(t('context.needsFolder'), 3);
        const refocus = () => (state.level === 'folders' ? foldersBox : listBox).focus();
        textPrompt(app, t('inject.dirPrompt'), process.cwd(), (dir) => {
          if (!dir) return refocus();
          const ctx = assembleContext(state.folder);
          if (!ctx) {
            app.notify(t('inject.noKnowledge', state.folder), 3);
            return refocus();
          }
          confirmText(app, t('inject.previewTitle', dir.trim()), ctx, (ok) => {
            if (!ok) {
              app.notify(t('inject.cancelled'), 2);
              return refocus();
            }
            const res = injectAgentsMd(dir.trim(), state.folder);
            app.notify(res.ok ? t('inject.done', dir.trim()) : res.error, 3);
            refocus();
          });
        });
      };
      listBox.key('i', doInject);
      foldersBox.key('i', doInject);

      // Expose hooks the action steps (organize/capture/reuse) bind onto.
      this._api = {
        app,
        get row() {
          return currentRow();
        },
        get selection() {
          return [...state.selected];
        },
        clearSelection() {
          state.selected.clear();
        },
        reloadAll() {
          data.refresh();
          reloadFolders();
          reloadList();
          updateStatusBar();
          updatePanelLabels();
          app.render();
        },
        // Same reset mount()'s own tail does (Root, folders pane focused,
        // fresh data) — for callers that need to drop back to a clean
        // baseline (e.g. the tutorial ending) WITHOUT a second app.show()/
        // mount() call. Re-mounting this view was tried first and re-ran
        // every screenKey()/resize registration on top of the still-live
        // ones from the first mount (unmount() never tore anything down),
        // which left stale closures capturing already-detached boxes and
        // crashed later (Cannot read properties of null (reading 'height'))
        // the next time a real handler like drillIntoDetail fired.
        //
        // A real bug: if the tutorial finished while still on the Calendar
        // tab (`v`, never toggled back before the last step's `q`), this
        // reset only touched Sessions' own state — calTab stayed active and
        // its boxes stayed visible, but `foldersBox.focus()` below yanked
        // blessed's actual keyboard focus onto the still-HIDDEN Sessions
        // panel underneath. The result wasn't just "stuck showing Calendar"
        // — every keypress (Enter, Escape, anything) was being delivered to
        // an invisible widget, so nothing on screen ever responded, reading
        // as a frozen/unclosable modal. Mirror showSessionsTab()'s own
        // tab-exit steps first so focus lands back on something visible.
        resetToRoot() {
          if (activeTab === 'calendar') {
            if (calTab) calTab.deactivate();
            activeTab = 'sessions';
            foldersBox.show();
            listBox.show();
            detailBox.show();
            updateHeader();
          }
          data.refresh();
          state.selected.clear();
          foldersBox.select(0);
          previewFolder();
          foldersBox.focus();
          setLevel('folders');
          app.render();
        },
        listBox,
        get state() {
          return state;
        },
      };
      if (opts.onReady) opts.onReady(this._api);

      // k9s model: start on the folders pane. Enter drills into sessions.
      previewFolder();
      foldersBox.focus();
      foldersBox.select(0);
      setLevel('folders');
    },
    unmount() {},
  };
}

// Attach a screen-level key without leaking across view swaps.
// Simple modal text prompt. The question is shown inside via .input(); no
// border label (setting both duplicates the title).
export function prompt(app, label, initial, cb) {
  const p = blessed.prompt({
    parent: app.screen,
    top: 'center',
    left: 'center',
    width: '60%',
    height: 'shrink',
    border: { type: 'line' },
    tags: true,
    style: { border: { fg: C.fox }, fg: C.text },
  });
  p.input(label, initial || '', (err, val) => {
    p.destroy();
    app.render();
    if (!err) cb(val);
  });
}
