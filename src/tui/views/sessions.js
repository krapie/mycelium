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

// Caps the number of sessions summarized by one `o` run, so a large
// first-time backlog cannot exhaust a tight usage quota. Lower than
// suggestPlacements()'s limit:200 because summarizing costs more per item.
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
  // Guards o/k/w/Shift+S/Shift+M against a double-press race stacking a
  // second review modal (breaks tutorial.js's isModalOpen() baseline).
  // Released once the "immediate" part finishes, not through merge/split's
  // later auto-summarize — holding it longer broke legitimate follow-ups.
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
      const src = `{${sourceColor(r.source)}-fg}#${sourceLabel(r.source)}{/}`;
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
      return `${mark}${text}{|}${lineage}${link}${src} ${isNew}`;
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
      // session — git-like (originals' turns untouched, just superseded;
      // reversible via `mycelium unmerge`). Blessed reports Shift+letter as
      // 'S-<letter>'. Same key also REVERTS when there's nothing to merge
      // (0-1 targets that turn out to be a merge product already) — brings
      // unmerge(), previously CLI-only, into the TUI without a second key.
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
      function doMerge() {
        const ids = [...state.selected];
        if (ids.length <= 1) {
          const targetId = ids[0] ?? currentRow()?.id;
          if (targetId && doUnmerge(targetId)) return;
        }
        if (ids.length < 2) return app.notify(t('merge.needsTwo'), 3);
        // See asyncReviewFlowRunning's own comment (near `state`'s
        // declaration) — guards only the title prompt, released once it closes.
        if (asyncReviewFlowRunning) return;
        asyncReviewFlowRunning = true;
        // Tutorial-only hook (see tutorial.js's app.tutorialSignal) — lets
        // the narrator advance whether Shift+M was pressed directly or
        // selected from the `.` action menu, since both call this exact
        // function. Placed here, past the <2-selected no-op above, so a
        // no-op press never fires a false "merge happened" signal.
        app.tutorialSignal?.('merge');
        textPrompt(app, t('merge.titlePrompt'), suggestMergeTitle(ids), async (title) => {
          asyncReviewFlowRunning = false;
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
      listBox.key('S-m', doMerge);

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
        // See asyncReviewFlowRunning's own comment (near `state`'s declaration).
        if (asyncReviewFlowRunning) return;
        asyncReviewFlowRunning = true;
        // Tutorial-only hook, same reasoning as doMerge's — past the
        // no-current-row/unsplit-revert branches above, so it only fires on
        // a genuine forward split attempt.
        app.tutorialSignal?.('split');
        const spin = app.startSpinner(t('split.suggesting'));
        const res = await suggestSplitBoundaries(r.id);
        spin.stop();
        if (!res.ok) {
          asyncReviewFlowRunning = false;
          return app.notify(res.error, 3);
        }
        const items = res.ranges.map((rg) => ({ label: t('split.turnRangeLabel', rg.from, rg.to, rg.label), value: rg }));
        // defaultAll: true, same as smart-organize's review — the LLM
        // already proposed these ranges, so reviewing means "uncheck the
        // wrong one," not "check the right ones." Guard released once the
        // modal opens, same scope as `o`/`w`'s guards.
        asyncReviewFlowRunning = false;
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
          // piece. Deliberately not re-arming asyncReviewFlowRunning here —
          // an earlier attempt did, to protect the shared toast, but that
          // blocked legitimate immediate follow-ups like another Shift+S.
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
      // Named (not inline) so the `.` action palette's FOLDER group can reuse
      // the exact same handler, same reasoning as doOrganize/doMerge/
      // doNewAgent below.
      const doScan = () => {
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
      };
      screenKey(app, ['s'], doScan);

      // o: smart organize — LLM content-based folder suggestions (see
      // organize.js's suggestPlacements()). Fresh candidates are scoped to
      // state.folder (Root/New/subtree, same semantics as data.sessions()),
      // so reviewing "this folder" doesn't drag in the whole store. Always
      // preview-then-confirm, unlike `s`'s plain scan.
      screenKey(app, ['o'], doOrganize);
      // Named (not an inline screenKey closure) so the `.` action menu can
      // invoke the exact same guarded flow — see openActionMenu().
      async function doOrganize() {
        // See asyncReviewFlowRunning's own comment above — an impatient
        // repeat press while the LLM call is still in flight used to start
        // a second concurrent run.
        if (asyncReviewFlowRunning) return;
        asyncReviewFlowRunning = true;
        // Tutorial-only hook, same reasoning as doMerge's — past the
        // in-flight guard above, so a swallowed impatient repeat press never
        // double-fires it (harmless either way, tutorial.js's own signal
        // handler no-ops while already waiting, but there's no reason to
        // rely on that here too).
        app.tutorialSignal?.('organize');
        try {
          await runSmartOrganize();
        } finally {
          asyncReviewFlowRunning = false;
        }
      }
      async function runSmartOrganize() {
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
      screenKey(app, ['k'], doRefreshKnowledge);
      // Named for the `.` action menu, same reasoning as doOrganize above.
      async function doRefreshKnowledge() {
        if (asyncReviewFlowRunning) return;
        asyncReviewFlowRunning = true;
        try {
          await runKnowledgeReview();
        } finally {
          asyncReviewFlowRunning = false;
        }
      }
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

      // Approving KNOWLEDGE.md content is one decision; which real project
      // directories get it is a separate one — a folder can span several
      // directories a session merely ran in, and dirsForFolder() can't tell
      // "the project" from "somewhere incidental". 0-1 directory injects
      // straight through; 2+ shows a pre-checked checklist to catch a stray one.
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
          if (r) {
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

      // Capture: launch a new agent session in the current folder's context.
      // launchAgent() (launch.js) asks "open here or copy command" — "copy
      // command" doesn't capture anything, so the refresh below is a
      // harmless no-op in that case. Named so the `.` menu can reuse it.
      function doNewAgent() {
        // launchAgent() already reindexes what scan() captured internally.
        launchAgent(app, { folder: state.folder, title: t('launch.selectAgentNew') }, () => {
          reloadFolders();
          reloadList();
          listBox.focus();
          app.render();
        });
      }
      listBox.key('n', doNewAgent);

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
          asyncReviewFlowRunning = false;
        }
      };
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
