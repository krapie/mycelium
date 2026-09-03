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
} from '../../organize.js';
import { pickFolder, editTags, menu } from '../widgets/pickers.js';
import { createCalendarTab } from './calendar.js';
import { formatSessionDetail } from '../render.js';
import { basename } from 'node:path';
import { autoTagSession } from '../../learn.js';
import { mapConcurrent } from '../../llm.js';
import { assembleContext, injectAgentsMd } from '../../reuse.js';
import { textView, digestReader, confirmText, helpModal, welcomeModal } from '../widgets/viewers.js';
import { textPrompt } from '../widgets/pickers.js';
import { copyToClipboard } from '../clipboard.js';
import { t } from '../i18n.js';
import { createResumeHandoff } from '../resume-handoff.js';
import * as actions from './sessions-actions.js';

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
  const state = { folder: undefined, query: '', tags: [], selected: new Set(), sortBy: 'recent' };
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
    // A real bug: neo-blessed's List.setItems() re-matches the cursor by
    // comparing rendered TEXT against the old selection, not identity/index.
    // Two folders sharing a leaf name under different parents (e.g.
    // cases/CW vs projects/CW) can render identical rows and silently swap
    // the cursor onto the wrong one — restoring our own already-correct
    // index right after setItems() overrides that fragile guess.
    const wantIndex = foldersBox.selected;
    foldersBox.setItems(items);
    foldersBox.select(Math.min(wantIndex, items.length - 1));
  }

  // "recent" passes through data.sessions()'s own order (relevance during
  // search, else most-recent) — established Shift+O behavior. date-desc is
  // a real comparator for Shift+T's picker, so "newest first" always means
  // date order there, even mid-search.
  function sortRows(list) {
    if (state.sortBy === 'title') {
      return [...list].sort((a, b) =>
        (a.title || a.summary || a.preview || '').localeCompare(b.title || b.summary || b.preview || ''),
      );
    }
    if (state.sortBy === 'title-desc') {
      return [...list].sort((a, b) =>
        (b.title || b.summary || b.preview || '').localeCompare(a.title || a.summary || a.preview || ''),
      );
    }
    if (state.sortBy === 'date-desc') {
      return [...list].sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
    }
    if (state.sortBy === 'date-asc') {
      return [...list].sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''));
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
    // Same setItems() cursor bug as reloadFolders() (see that comment), but
    // higher-risk here: reloadList() runs after nearly every mutation, some
    // of which resort the list, so restoring by old numeric index alone
    // isn't reliable. Tracking the session id instead survives a resort and
    // is immune to setItems()'s text-matching heuristic.
    const wantId = rows[listBox.selected]?.id;
    const prevIndex = listBox.selected;
    rows = sortRows(data.sessions({ folder: state.folder, query: state.query, tags: state.tags }));
    const items = rows.map((r) => {
      // Agent name formatted as a hashtag, same visual language as tags —
      // and now trails the title instead of leading it, so the title (the
      // thing you're actually scanning for) reads first on the line.
      const src = r.kind === 'backlog' ? '' : `{${sourceColor(r.source)}-fg}#${sourceLabel(r.source)}{/}`;
      // No reserved gutter — the checkmark only takes space on rows you've
      // actually selected, so the title starts flush-left the rest of the
      // time instead of every row paying for a feature most rows don't use.
      const mark = state.selected.has(r.id) ? `{${C.fox}-fg}✓{/} ` : '';
      // Continuation markers moved into the right-hand metadata cluster —
      // they're relationship metadata about the row, same category as
      // agent/id, not something that belongs competing for the left edge.
      // Bracketed text tags, same visual language as isNew's [New] below —
      // no emoji for state/relationship markers anywhere in this codebase.
      // A session started from a backlog item is an ordinary session, not a
      // handoff: nothing was picked up from a previous agent, the note was
      // just its seed. Its origin lives in the detail panel (render.js), not
      // as a badge that would read as "this continues an earlier session".
      const link =
        r.continuationOf && !r.fromBacklog
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
      // Backlog items (backlog.js) carry no agent yet — an agent hashtag on
      // one would name whichever CLI happens to open it later, which is
      // exactly what hasn't been decided. The badge takes its place, and dims
      // once the item has been opened into a real session.
      const backlog =
        r.kind === 'backlog'
          ? `{${r.doneAt ? C.faint : C.fox}-fg}[${t(r.doneAt ? 'sessions.backlogOpenedBadge' : 'sessions.backlogBadge')}]{/}`
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
      const meta = [lineage.trim(), link.trim(), backlog, src, isNew].filter(Boolean).join(' ');
      return `${mark}${text}{|}${meta}`;
    });
    listBox.setItems(items.length ? items : [`{gray-fg}${t('sessions.empty')}{/}`]);
    if (items.length) {
      const idx = wantId ? rows.findIndex((r) => r.id === wantId) : -1;
      listBox.select(idx >= 0 ? idx : Math.min(prevIndex, items.length - 1));
    }
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

      // The Scan/Organize/Knowledge-review/Merge/Split/New-agent action
      // handlers (Phase 2 split, issue #88) live in sessions-actions.js as
      // functions taking this shared ctx, built once here so every key
      // binding/menu entry below can reference the same stable wrapper
      // regardless of where it's defined — a const/ctx alternative to the
      // function-declaration hoisting the old inline versions relied on
      // (`screenKey(app, ['o'], doOrganize)` used to precede `doOrganize`'s
      // own declaration). asyncReviewFlowRunning guards o/k/w/Shift+S/
      // Shift+M against a double-press race stacking a second review modal
      // (breaks tutorial.js's isModalOpen() baseline) — released once the
      // "immediate" part finishes, not through merge/split's later
      // auto-summarize — holding it longer broke legitimate follow-ups.
      const ctx = { app, state, foldersBox, listBox, detailBox, currentRow, reloadFolders, reloadList, asyncReviewFlowRunning: false };
      const doScan = () => actions.doScan(ctx);
      const doOrganize = () => actions.doOrganize(ctx);
      const doRefreshKnowledge = () => actions.doRefreshKnowledge(ctx);
      const doMerge = () => actions.doMerge(ctx);
      const doSplit = () => actions.doSplit(ctx);
      const doKnowledge = () => actions.doKnowledge(ctx);
      const doNewAgent = () => actions.doNewAgent(ctx);
      const doNewBacklog = () => actions.doNewBacklog(ctx);

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
      // Status bar shows the short Context Flywheel loop; the full
      // breakdown lives in the `?` modal instead. Factored out of setLevel()
      // so reloadAll() can also refresh it — index.js's language picker
      // mounts this view before the human picks a language, so a later
      // setLocale() needs a way to update chrome that's otherwise only
      // re-set on a level change.
      const updateStatusBar = () => {
        app.setStatus(' ' + t('lifecycle.bar', C.text) + '    ' + t('status.helpFallback'));
      };
      // Same staleness problem as updateStatusBar() above: these are blessed
      // widget CONSTRUCTION options (`label:`), not re-applied on render.
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

      // Shift+T: pick a sort order directly instead of cycling blind (issue
      // #51) — reaches the two directions Shift+O's cycle can't. Kept
      // separate from SORT_CYCLE (both just write state.sortBy, so they
      // can't disagree); "newest first" here is the real 'date-desc'
      // comparator, not 'recent's search-relevance pass-through.
      listBox.key('S-t', () => {
        menu(
          app,
          t('sessions.sortPickerTitle'),
          [
            { label: t('sessions.sortOption_recent'), value: 'date-desc' },
            { label: t('sessions.sortOption_dateAsc'), value: 'date-asc' },
            { label: t('sessions.sortOption_title'), value: 'title' },
            { label: t('sessions.sortOption_titleDesc'), value: 'title-desc' },
          ],
          (val) => {
            listBox.focus();
            if (val === undefined) return; // Escape — no change
            state.sortBy = val;
            reloadList();
            app.render();
          },
        );
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
      // session (git-like, reversible via `mycelium unmerge`) — same key
      // REVERTS when there's nothing to merge. See sessions-actions.js.
      listBox.key('S-m', doMerge);

      // Shift+S: LLM-suggested split — propose topic boundaries, human
      // reviews, apply only the checked ranges. See sessions-actions.js.
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
      // sessions land unfiled — use `o` (or `mycelium organize`) to place
      // them. See sessions-actions.js.
      screenKey(app, ['s'], doScan);

      // o: smart organize — LLM content-based folder suggestions, scoped to
      // state.folder, always preview-then-confirm. See sessions-actions.js.
      screenKey(app, ['o'], doOrganize);

      // k: knowledge review — mirrors o's shape (reuse what the daemon
      // queued overnight, else compute fresh), deliberately separate from
      // Digest (`d`). See sessions-actions.js.
      screenKey(app, ['k'], doRefreshKnowledge);

      // ?: full keymap reference — status bar only shows a short breadcrumb now.
      screenKey(app, ['?'], () => helpModal(app));

      // .: "What do you want to do?" action palette — a discoverable menu,
      // each entry showing its own key. Context-aware (Merge needs 2+
      // picked, Split/lineage need a current row) and scoped to the panel
      // you're in (Detail has nothing left to offer; Folders gets only
      // folder-scoped actions; Sessions gets both groups). Every entry's
      // `value` is the exact same handler its key triggers, so the two
      // paths can't drift. Esc closes with no action.
      function openActionMenu() {
        if (state.level === 'detail') return;

        const hint = (k) => `  {${C.text}-fg}(${k}){/}`;
        const items = [];

        // SESSION group — only shown when the sessions list is active AND has
        // a current row to act on. Merge additionally needs 2+ picked.
        if (state.level === 'sessions') {
          const r = currentRow();
          const multi = state.selected.size > 1;
          const sessionItems = [];
          if (r && r.kind === 'backlog') {
            // Nothing to hand off or split on a note nobody has worked on
            // yet — the one thing to do with it is start it (see
            // resume-handoff.js's doOpenBacklog).
            sessionItems.push({ label: `${t('actions.openBacklog')}${hint('r')}`, value: doOpenBacklog });
            sessionItems.push({ label: `${t('actions.lineage')}${hint('Enter')}`, value: drillIntoDetail });
          } else if (r) {
            sessionItems.push({ label: `${t('actions.handoff')}${hint('h')}`, value: () => doHandoff() });
            sessionItems.push({ label: `${t('actions.lineage')}${hint('Enter')}`, value: drillIntoDetail });
            sessionItems.push({ label: `${t('actions.split')}${hint('Shift+S')}`, value: doSplit });
          }
          if (multi) sessionItems.push({ label: `${t('actions.merge')}${hint('Shift+M')}`, value: doMerge });
          if (sessionItems.length) {
            items.push({ header: true, label: t('actions.groupSession') });
            items.push(...sessionItems);
            items.push({ header: true, label: '' }); // blank spacer between groups
          }
        }

        // FOLDER group — scoped to the folder/view you're browsing, not the
        // single session (that's why `o` lives here, not up top). Available
        // from both the sessions list and the folders panel.
        items.push({ header: true, label: t('actions.groupFolder') });
        items.push({ label: `${t('actions.scan')}${hint('s')}`, value: doScan });
        items.push({ label: `${t('actions.organize')}${hint('o')}`, value: doOrganize });
        items.push({ label: `${t('actions.knowledge')}${hint('w')}`, value: doKnowledge });
        items.push({ label: `${t('actions.newAgent')}${hint('n')}`, value: doNewAgent });
        items.push({ label: `${t('actions.newBacklog')}${hint('b')}`, value: doNewBacklog });
        menu(app, t('actions.title'), items, (fn) => {
          if (typeof fn === 'function') fn();
          // fn===undefined = palette dismissed without a choice (Esc, or a
          // screen-key like `o` stole focus and opened its own modal on
          // top). Nothing to do — the real action, if any, ran through
          // its own key handler already.
        }, { width: '50%', dismissOnBlur: true });
      }
      screenKey(app, ['.'], openActionMenu);

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

      // Capture: launch a new agent session in the current folder's
      // context. FOLDER-scoped (state.folder, not the selected row). Bound
      // explicitly on both boxes (matching w/doKnowledge's own pattern),
      // not a global screenKey — confirmed via a headless dry run that
      // screenKey would let a second `n` press re-enter this whole flow
      // while the agent/directory picker it just opened still has focus,
      // stacking a second one on top; an explicit per-box binding naturally
      // can't fire once focus has moved to a different widget. See
      // sessions-actions.js.
      listBox.key('n', doNewAgent);
      foldersBox.key('n', doNewAgent);

      // b: write down something to work on later, in the folder you're
      // browsing. Same both-boxes/per-box binding as `n` above and for the
      // same reasons (folder-scoped, and its own prompt must not be
      // re-enterable while it's open). See sessions-actions.js.
      listBox.key('b', doNewBacklog);
      foldersBox.key('b', doNewBacklog);

      // Resume/handoff/copy-command trio — shared with the Calendar tab's
      // day-list/detail (see resume-handoff.js). Only the "what's currently
      // selected" accessor and the post-action callbacks are view-specific.
      const { doResume, doHandoff, onDetailEnter, doOpenBacklog } = createResumeHandoff(app, {
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

      // Learn: generate summary + tags (content-based), multi-selection or
      // current row. Runs up to 3 at once via mapConcurrent() (llm.js), same
      // bounded-concurrency pattern as organize.js/learn.js; the progress
      // toast advances on each completion, not each start.
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
        const save = (fields) => {
          const res = setContent(r.id, fields);
          app.notify(res.ok ? t('editor.saved') : t('editor.saveFailed', res.error), res.ok ? 2 : 3);
          data.refreshOne(r.id);
          reloadFolders();
          reloadList();
          if (currentRow() && currentRow().id === r.id) showDetail(r.id);
          app.render();
        };
        textPrompt(app, t('editor.titlePrompt'), n?.extracted.title || '', (val) => {
          if (val === null) return; // Esc — cancelled
          // A backlog item's description is the user's own text too (it's what
          // seeds the agent when the item is opened), so `e` edits both fields
          // — unlike a captured session, whose summary stays AI-generated.
          if (r.kind !== 'backlog') return save({ title: val });
          textPrompt(app, t('editor.descPrompt'), n?.extracted.summary || '', (desc) => {
            save(desc === null ? { title: val } : { title: val, summary: desc });
          });
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
      // human what it's about to write, and only save on explicit confirm.
      // See sessions-actions.js.
      listBox.key('w', doKnowledge);
      foldersBox.key('w', doKnowledge);

      // d: digest viewer (browse existing; generate new from inside via n/w).
      screenKey(app, ['d'], () => digestReader(app));
      // c: preview inherited context for state.folder (not currentRow().folder),
      // same dual-panel binding as w — list-only binding left the tutorial's
      // isModalOpen() poll stuck after pressing ← back to Folders.
      const doContext = () => {
        if (!state.folder) return app.notify(t('folders.selectFirst'), 3);
        const ctx = assembleContext(state.folder);
        textView(app, t('context.title', state.folder), ctx || t('context.empty'), ['c']);
      };
      listBox.key('c', doContext);
      foldersBox.key('c', doContext);
      // i: inject the folder's KNOWLEDGE.md into a directory's AGENTS.md —
      // shows exactly what will be written first. Same state.folder +
      // dual-panel binding as c, for the same reason (see that comment).
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
        // Same reset mount()'s own tail does, for callers needing a clean
        // baseline (e.g. tutorial end) without a second mount() call —
        // re-mounting was tried first, but left stale closures over
        // detached boxes that crashed later. Also mirrors showSessionsTab()'s
        // tab-exit steps first: if the tutorial ended on the Calendar tab,
        // focusing foldersBox directly left focus on a hidden panel, reading
        // as a frozen, unresponsive app.
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
