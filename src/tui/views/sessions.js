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
  foldProductIntoSession,
} from '../../organize.js';
import { suggestSplitBoundaries, applySplit } from '../../split.js';
import { scan } from '../../scanner.js';
import { pickFolder, editTags, menu, multiSelectList } from '../widgets/pickers.js';
import { createCalendarTab } from './calendar.js';
import { formatSessionDetail } from '../render.js';
import { basename } from 'node:path';
import { launchAgent, resumeSession } from '../launch.js';
import { resumeCommandLine } from '../../agents.js';
import { buildHandoff } from '../../handoff.js';
import { autoTagSession } from '../../learn.js';
import { buildKnowledgeText, writeKnowledgeText } from '../../insight.js';
import { assembleContext, injectAgentsMd } from '../../reuse.js';
import { textView, digestReader, confirmText, helpModal, welcomeModal } from '../widgets/viewers.js';
import { textPrompt } from '../widgets/pickers.js';
import { copyToClipboard } from '../clipboard.js';
import { t } from '../i18n.js';

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
  let state = { folder: undefined, query: '', tags: [], selected: new Set(), sortBy: 'recent' };
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
    foldersBox.setItems(items);
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
      // (↩ 이어받음/→ 이어감), so you can match a row here to that label there.
      const idPrefix = `{${C.dim}-fg}#${r.id.slice(0, 8)}{/}`;
      // No reserved gutter — the checkmark only takes space on rows you've
      // actually selected, so the title starts flush-left the rest of the
      // time instead of every row paying for a feature most rows don't use.
      const mark = state.selected.has(r.id) ? `{${C.fox}-fg}✓{/} ` : '';
      // Continuation markers moved into the right-hand metadata cluster —
      // they're relationship metadata about the row, same category as
      // agent/id, not something that belongs competing for the left edge.
      // Trailing space is required, not cosmetic: ↩/→ are ambiguous-width
      // glyphs that render wider than one column in most terminal fonts, so
      // packing them directly against the next character visually overlapped it.
      const link = r.continuationOf ? `{${C.spore}-fg}↩{/} ` : (r.continuedTo && r.continuedTo.length) ? `{${C.spore}-fg}→{/} ` : '';
      // Same marker language, different glyph: 🔀 merge product, ✂ split
      // piece, ⤳ a session with related derived content elsewhere —
      // supersededBy (merge original — hidden by default, so this case is
      // mostly unreachable in practice) or splitInto (split original, which
      // DOES stay visible, unlike a merge original, since none of its
      // content actually moved anywhere).
      const lineage = r.mergedFrom?.length
        ? `{${C.merged}-fg}🔀{/} `
        : r.splitFrom
          ? `{${C.merged}-fg}✂{/} `
          : r.supersededBy?.length || r.splitInto?.length
            ? `{${C.faint}-fg}⤳{/} `
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
        label: ' Folders ',
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
        label: ' Sessions ',
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
        label: ' Detail ',
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
      // Status bar shows the lifecycle bar (which keys belong to which stage)
      // instead of per-level nav hints — no free row anywhere on screen to
      // show both, and this is the more useful thing to have visible at all
      // times. Full keymap (incl. Enter/Esc nav) still lives in the ? modal.
      const setLevel = (lvl) => {
        state.level = lvl;
        applyLayout(lvl);
        app.setStatus(' ' + t('lifecycle.bar', C.text, C.faint, C.border) + '  ' + t('status.helpFallback'));
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
      listBox.key('S-m', () => {
        const ids = [...state.selected];
        if (ids.length < 2) return app.notify(t('merge.needsTwo'), 3);
        textPrompt(app, t('merge.titlePrompt'), '', (title) => {
          if (title === null) return listBox.focus(); // Esc — cancelled
          const res = mergeSessions(ids, { title: title.trim() || undefined });
          if (!res.ok) return app.notify(res.error, 3);
          state.selected.clear();
          data.refreshMany([res.merged.id, ...ids]);
          reloadFolders();
          reloadList();
          app.notify(t('merge.done', ids.length), 3);
          listBox.focus();
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
        app.notify(t('split.suggesting'), 60);
        const res = await suggestSplitBoundaries(r.id);
        if (!res.ok) return app.notify(res.error, 3);
        const items = res.ranges.map((rg) => ({ label: `턴 ${rg.from}-${rg.to}  "${rg.label}"`, value: rg }));
        multiSelectList(app, t('split.reviewTitle'), items, (chosen) => {
          if (!chosen?.length) return; // Esc or nothing checked — original untouched
          const applied = applySplit(r.id, chosen);
          if (!applied.ok) return app.notify(applied.error, 3);
          data.refreshMany([r.id, ...applied.pieces.map((p) => p.id)]);
          app.notify(t('split.done', applied.pieces.length), 3);
          reloadFolders();
          reloadList();
          listBox.focus();
          app.render();
        });
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
          // organize.js), so show real progress instead of one static toast
          // that expires long before a multi-session batch finishes and
          // makes it look hung.
          const pending = classificationCandidates({ cooldownMs: 0, folder: state.folder }).filter(
            (n) => !n.extracted.summary,
          ).length;
          if (pending) app.notify(t('sessions.summarizing', 0, pending), 90);
          const summarized = [];
          await summarizeCandidates({
            folder: state.folder,
            onProgress: (() => {
              let done = 0;
              return (s) => {
                if (s) summarized.push(s.id);
                app.notify(t('sessions.summarizing', ++done, pending), 90);
              };
            })(),
          });
          // Only the just-summarized sessions actually changed.
          if (summarized.length) data.refreshMany(summarized);
          app.notify(t('smart.running'), 60);
          const res = await suggestPlacements({
            cooldownMs: 0,
            folder: state.folder,
            // Same reasoning as daemon.js's SMART_ORGANIZE_BATCH_LIMIT — a
            // large backlog could otherwise mean hundreds of LLM calls in
            // one `o` press.
            limit: 200,
            onProgress: (batch, total) => total > 1 && app.notify(`${t('smart.running')} (${batch}/${total})`, 60),
          });
          if (!res.ok) return app.notify(res.error, 4);
          matches = res.placements.filter((p) => p.folder);
          if (!matches.length) return app.notify(t('smart.noMatches'), 3);
          queueSuggestions(matches);
        }
        // Dismiss the still-counting-down "summarizing/classifying" toast —
        // its own timer (60-90s) doesn't fire early, so without this it's
        // still on screen, visibly overlapping the review modal opening
        // right below (both are centered blessed overlays).
        app.dismissNotify();
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
      });

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

      // Shared tail for any real resume.
      const doActualResume = (session) => {
        // resumeSession() (launch.js) already reindexes exactly what changed.
        resumeSession(app, session, () => {
          reloadFolders();
          reloadList();
          listBox.focus();
          setLevel('sessions');
          app.render();
        });
      };

      // Reuse: hand the current session off to another agent (seeded NEW
      // session). `fallback: true` means this handoff is doResume()'s
      // substitute for a merge/split product that has no real agent-native
      // id to resume — explain that in the agent-picker's own title instead
      // of a separate app.notify() toast, which would just visibly overlap
      // the picker (both are centered overlays and the picker opens in the
      // same tick, before a timed toast has any time to be read).
      const doHandoff = ({ fallback = false } = {}) => {
        const r = currentRow();
        if (!r) return;
        const hb = buildHandoff(r.id);
        if (!hb.ok) return app.notify(hb.error, 3);
        const isDerived = r.mergedFrom?.length || r.splitFrom;
        // launchAgent() (launch.js) already reindexes exactly what changed,
        // and already linkContinuation()s the new session to r.id.
        launchAgent(app, { folder: r.folder, seed: hb.prompt, parentId: r.id, title: fallback ? t('launch.selectAgentFallback') : undefined }, (mine) => {
          // A merge/split product only ever existed to seed this handoff —
          // once a real, directly-resumable session exists, fold the
          // product's content into it and drop the product entirely, so
          // there's one ordinary session left (not two rows, and no
          // continued special-casing: from here on `r` on the new session
          // is just a normal resume, see organize.js's foldProductIntoSession).
          if (isDerived && mine?.[0]) {
            const res = foldProductIntoSession(r.id, mine[0].id);
            if (res.ok) {
              data.refreshOne(r.id); // gone — reindex removes it
              data.refreshOne(mine[0].id); // now holds the folded turns
              data.refreshMany(res.touchedIds || []); // their backlinks changed too
            }
          }
          reloadFolders();
          reloadList();
          listBox.focus();
          app.render();
        });
      };
      listBox.key('h', () => doHandoff());

      // Reuse: RESUME the exact session in its original agent (claude --resume / codex resume).
      // A merge/split product has no real agent-native id to resume — `r`
      // falls back to handoff, which folds the product into whatever real
      // session that produces (see doHandoff above), so this only ever
      // happens once per product: after that it's gone, replaced by an
      // ordinary session `r` resumes normally.
      const doResume = () => {
        const r = currentRow();
        if (!r) return;
        const n = data.detail(r.id);
        if (n?.mergedFrom?.length || n?.splitFrom) {
          return doHandoff({ fallback: true });
        }
        doActualResume({ id: r.id, source: r.source, cwd: n?.cwd, projectDir: n?.projectDir });
      };
      listBox.key('r', doResume);
      // Detail panel uses Enter instead of r — it's the leaf level, so Enter
      // (the drill-down/act key everywhere else in this view) is free here.
      // Unlike listBox's `r` (instant resume), Enter offers a choice: resume
      // right here, or copy the equivalent shell command for a new tab.
      detailBox.key('enter', () => {
        const r = currentRow();
        if (!r) return;
        // "Copy command" pastes into a brand-new terminal outside the TUI —
        // there's no way to auto-absorb through that path, and a merge/split
        // product's id isn't a real agent-native session id to begin with,
        // so the copied command would just fail with "session not found"
        // when actually run. Only offer it for a real, truly resumable session.
        const isDerived = r.mergedFrom?.length || r.splitFrom;
        const choices = [{ label: t('resume.openHere'), value: 'here' }];
        if (!isDerived) choices.push({ label: t('resume.copyCommand'), value: 'copy' });
        menu(
          app,
          t('resume.chooseAction'),
          choices,
          (choice) => {
            if (choice === 'here') return doResume();
            if (choice === 'copy') {
              const n = data.detail(r.id);
              const res = resumeCommandLine({ id: r.id, source: r.source, cwd: n?.cwd, projectDir: n?.projectDir });
              if (!res.ok) return app.notify(res.error, 3);
              app.notify(copyToClipboard(res.line) ? t('resume.copied') : t('resume.copyFailed'), 3);
            }
          },
        );
      });

      // Learn: generate summary + tags (content-based). Works on the multi-
      // selection if any, else the current row. This is how a session gets its
      // summary — the LLM reads the session and writes the task summary + tags.
      const doAutoTag = async () => {
        const ids = state.selected.size ? [...state.selected] : currentRow() ? [currentRow().id] : [];
        if (!ids.length) return;
        let done = 0;
        let failed = 0;
        let lastError = null;
        for (const id of ids) {
          app.notify(t('sessions.summarizing', done + 1, ids.length), 90);
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
          // Only `id` changed this iteration — a full reindex() here would
          // reparse the whole raw/ store once per selected session (an N×
          // full-store rebuild for an N-session multi-select autotag).
          data.refreshOne(id);
          reloadList();
          if (currentRow() && currentRow().id === id) showDetail(id);
        }
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
        const refocus = () => (state.level === 'folders' ? foldersBox : listBox).focus();
        app.notify(t('knowledge.generating'), 90);
        const gen = await buildKnowledgeText(state.folder);
        // Dismiss the still-counting-down "drafting" toast — its own timer
        // doesn't fire early, so without this it's still on screen right as
        // the preview opens right below (both centered overlays), and on a
        // slow/large folder the LLM call can outlast the toast's own fixed
        // duration entirely, leaving it looking finished well before it is.
        app.dismissNotify();
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
      };
      listBox.key('w', doKnowledge);
      foldersBox.key('w', doKnowledge);

      // d: digest viewer (browse existing; generate new from inside via n/w).
      screenKey(app, ['d'], () => digestReader(app));
      listBox.key('c', () => {
        const r = currentRow();
        if (!r) return;
        const ctx = assembleContext(r.folder);
        textView(app, t('context.title', r.folder || t('sessions.newBadge')), ctx || t('context.empty'));
      });
      // i: inject the folder's KNOWLEDGE.md into a directory's AGENTS.md —
      // show exactly what will be written before touching that file.
      listBox.key('i', () => {
        const r = currentRow();
        if (!r || !r.folder) return app.notify(t('context.needsFolder'), 3);
        textPrompt(app, t('inject.dirPrompt'), process.cwd(), (dir) => {
          if (!dir) return listBox.focus();
          const ctx = assembleContext(r.folder);
          if (!ctx) {
            app.notify(t('inject.noKnowledge', r.folder), 3);
            return listBox.focus();
          }
          confirmText(app, t('inject.previewTitle', dir.trim()), ctx, (ok) => {
            if (!ok) {
              app.notify(t('inject.cancelled'), 2);
              return listBox.focus();
            }
            const res = injectAgentsMd(dir.trim(), r.folder);
            app.notify(res.ok ? t('inject.done', dir.trim()) : res.error, 3);
            listBox.focus();
          });
        });
      });

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
        resetToRoot() {
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
