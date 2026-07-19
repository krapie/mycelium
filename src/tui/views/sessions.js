import pkg from 'neo-blessed';
const blessed = pkg.default || pkg;
import { C, sourceColor } from '../theme.js';
import * as data from '../data.js';
import { move as organizeMove, tag as organizeTag, mkdir, renameFolder, deleteFolder, deleteSession } from '../../organize.js';
import { scan } from '../../scanner.js';
import { pickFolder, editTags, menu } from '../widgets/pickers.js';
import { basename } from 'node:path';
import { launchAgent, resumeSession } from '../launch.js';
import { buildHandoff } from '../../handoff.js';
import { autoTagSession } from '../../learn.js';
import { buildKnowledgeText, writeKnowledgeText } from '../../insight.js';
import { assembleContext, injectAgentsMd } from '../../reuse.js';
import { textView, digestReader, confirmText, helpModal } from '../widgets/viewers.js';
import { textPrompt } from '../widgets/pickers.js';
import { copyToClipboard } from '../clipboard.js';
import { editSessionContent } from '../widgets/editor.js';
import { t } from '../i18n.js';

// Break a summary paragraph into sentence-sized bullet points for the detail
// pane. summary is stored as prose (learn.js asks the LLM for 2-3 sentences),
// but a dense paragraph is harder to scan than the bullet list decisions/todos
// already use — this is a display-only split, the stored string is untouched.
function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

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
  let state = { folder: null, query: '', tags: [], selected: new Set() };
  let app;
  let foldersBox, listBox, detailBox;
  let rows = [];

  function reloadFolders() {
    const { list, counts, inbox } = data.folders();
    // Root's count is unfiled sessions only, matching what it actually shows
    // now — not every session everywhere (those live in their own folder).
    const items = [`{${state.folder === null ? C.fox : C.dim}-fg}${t('folders.root')} (${inbox}){/}`];
    const keys = [null];
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

  function reloadList() {
    rows = data.sessions({ folder: state.folder, query: state.query, tags: state.tags });
    const items = rows.map((r) => {
      // Readable colored agent label instead of a bare color dot.
      const name = r.source === 'codex' ? 'codex ' : 'claude';
      const src = `{${sourceColor(r.source)}-fg}${name}{/}`;
      // Same "source #idPrefix" shape as the continuation links in detail
      // (↩ 이어받음/→ 이어감), so you can match a row here to that label there.
      const idPrefix = `{${C.dim}-fg}#${r.id.slice(0, 8)}{/}`;
      const mark = state.selected.has(r.id) ? `{${C.fox}-fg}✓{/}` : ' ';
      const link = r.continuationOf ? `{${C.spore}-fg}↩{/}` : (r.continuedTo && r.continuedTo.length) ? `{${C.spore}-fg}→{/}` : ' ';
      const isNew = !r.folder ? `{${C.spore}-fg}[${t('sessions.newBadge')}]{/}` : '';
      const text = (r.title || r.summary || r.preview || t('common.noContent')).replace(/\s+/g, ' ').slice(0, 58);
      // A space after link is required, not cosmetic: ↩/→ are ambiguous-width
      // glyphs that render wider than one column in most terminal fonts, so
      // packing them directly against the agent name visually overlapped it.
      // Tags moved to the detail pane — this row was getting crowded.
      return `${mark}${link} ${src} ${idPrefix} ${text} ${isNew}`;
    });
    listBox.setItems(items.length ? items : [`{gray-fg}${t('sessions.empty')}{/}`]);
    updateHeader();
  }

  function updateHeader() {
    const crumb = state.folder || t('folders.root');
    const filt = [state.query && `/${state.query}`, ...state.tags.map((tg) => `#${tg}`)].filter(Boolean).join(' ');
    app.setHeader(`${crumb}${filt ? '  {' + C.spore + '-fg}' + filt + '{/}' : ''}`, `${rows.length} sessions`);
  }

  function showDetail(id) {
    const n = data.detail(id);
    if (!n) return;
    const lines = [];
    const srcName = n.source === 'codex' ? 'codex' : 'claude';
    // Title as the headline, then metadata, then the description (summary).
    if (n.extracted.title) lines.push(`{${C.fox}-fg}{bold}${n.extracted.title}{/}`);
    lines.push(
      `{${sourceColor(n.source)}-fg}${srcName}{/}  {${C.dim}-fg}${(n.startedAt || '').slice(0, 16).replace('T', ' ')} · ${n.folder || t('sessions.newBadge')}{/}`,
    );
    if (n.extracted.tags?.length) {
      lines.push(`{${C.faint}-fg}${t('detail.tags')}{/} ` + n.extracted.tags.map((tg) => `{${C.fox}-fg}#${tg}{/}`).join(' '));
    }
    lines.push('');
    if (n.extracted.summary) {
      // Bullet points, not one prose paragraph — matches decisions/todos
      // below and is much easier to scan than a dense block of sentences.
      lines.push(...splitSentences(n.extracted.summary).map((s) => `{${C.text}-fg}  · ${s}{/}`), '');
    } else {
      lines.push(`{${C.faint}-fg}${t('detail.noSummary')}{/}`, '');
      const firstUser = n.turns.find((turn) => turn.role === 'user')?.text;
      if (firstUser) lines.push(`{${C.faint}-fg}${t('detail.firstRequest')}{/} ${firstUser.replace(/\s+/g, ' ').slice(0, 300)}`, '');
    }
    if (n.extracted.decisions?.length) lines.push(`{${C.faint}-fg}${t('detail.decisions')}{/}`, ...n.extracted.decisions.map((d) => `  · ${d}`), '');
    if (n.extracted.todos?.length) lines.push(`{${C.faint}-fg}${t('detail.todos')}{/}`, ...n.extracted.todos.map((td) => `  · ${td}`), '');
    // Handoff continuation links (this is one flow across a model switch).
    if (n.continuationOf) {
      const p = data.detail(n.continuationOf);
      const label = p ? p.source + ' #' + n.continuationOf.slice(0, 8) : '#' + n.continuationOf.slice(0, 8);
      lines.push('', `{${C.spore}-fg}${t('detail.continuationOf', label)}{/}`);
    }
    for (const cid of n.continuedTo || []) {
      const c = data.detail(cid);
      const label = c ? c.source + ' #' + cid.slice(0, 8) : '#' + cid.slice(0, 8);
      lines.push(`{${C.spore}-fg}${t('detail.continuedTo', label)}{/}`);
    }
    detailBox.setContent(lines.join('\n'));
    detailBox.setScroll(0);
    app.render();
  }

  function currentRow() {
    return rows[listBox.selected];
  }

  return {
    help: t('status.helpFallback'),
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
      const setLevel = (lvl) => {
        state.level = lvl;
        applyLayout(lvl);
        // Full keymap lives in the ? modal now, not crammed into this line —
        // just enough breadcrumb to know where you are and how to get help.
        const hints = {
          folders: t('status.folders'),
          sessions: t('status.sessions'),
          detail: t('status.detail'),
        };
        app.setStatus(' ' + (hints[lvl] || this.help));
      };

      // Live-preview the highlighted folder's sessions as you move (no drill yet).
      const previewFolder = () => {
        state.folder = foldersBox._keys[foldersBox.selected];
        reloadFolders();
        reloadList();
        if (rows[0]) showDetail(rows[0].id);
        app.render();
      };
      foldersBox.on('keypress', (ch, key) => {
        if (key && ['up', 'down', 'k', 'j', 'pageup', 'pagedown', 'home', 'end', 'g'].includes(key.name)) {
          setImmediate(previewFolder);
        }
      });
      // Enter a folder → drill into its sessions.
      foldersBox.key('enter', () => {
        previewFolder();
        listBox.focus();
        listBox.select(0);
        if (rows[0]) showDetail(rows[0].id);
        setLevel('sessions');
        app.render();
      });

      // ── Folder management (only when the folders pane is focused) ──
      const curFolder = () => foldersBox._keys[foldersBox.selected];
      // The only non-real entry in this panel now is Root itself (key: null).
      const isRealFolder = (f) => !!f;
      const refreshFolders = (selectPath) => {
        state.selected.clear();
        data.refresh();
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
          refreshFolders(res.ok ? res.to : f);
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
          refreshFolders(res.ok ? res.to : f);
        });
      });

      // x: delete the selected folder (sessions → unfiled, shown as New in Root).
      foldersBox.key('x', () => {
        const f = curFolder();
        if (!isRealFolder(f)) return app.notify(t('folders.cannotDeleteRoot'), 3);
        menu(
          app,
          t('folders.deleteConfirmTitle', f),
          [
            { label: t('folders.deleteConfirmYes', t('folders.root')), value: 'yes' },
            { label: t('common.cancel'), value: 'no' },
          ],
          (ans) => {
            foldersBox.focus();
            if (ans !== 'yes') return;
            const res = deleteFolder(f);
            app.notify(res.ok ? t('folders.deleted', res.moved) : res.error);
            state.folder = null;
            refreshFolders(null);
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
      listBox.key('enter', () => {
        detailBox.focus();
        setLevel('detail');
        app.render();
      });
      listBox.key('escape', () => {
        foldersBox.focus();
        setLevel('folders');
        app.render();
      });
      detailBox.key(['escape'], () => {
        listBox.focus();
        setLevel('sessions');
        app.render();
      });

      // Multi-select toggle.
      listBox.key('space', () => {
        const r = currentRow();
        if (!r) return;
        if (state.selected.has(r.id)) state.selected.delete(r.id);
        else state.selected.add(r.id);
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

      // Live search.
      screenKey(app, ['/'], () => {
        prompt(app, t('common.searchPrompt'), state.query, (val) => {
          state.query = (val || '').trim();
          reloadList();
          listBox.focus();
          app.render();
        });
      });

      // s: scan only (capture new/changed sessions from every tab/terminal +
      // reindex), without leaving the TUI. Mirrors `mycelium scan`. Does NOT
      // auto-organize — that reassigns folders by cwd rule and isn't wired to
      // any key here yet; run `mycelium organize` when you want that.
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

      // ?: full keymap reference — status bar only shows a short breadcrumb now.
      screenKey(app, ['?'], () => helpModal(app));

      // Which sessions an action targets: the multi-selection if any, else the row under the cursor.
      const targets = () => (state.selected.size ? [...state.selected] : currentRow() ? [currentRow().id] : []);

      const afterMutate = () => {
        state.selected.clear();
        data.refresh();
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
          afterMutate();
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
          afterMutate();
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
            for (const id of ids) deleteSession(id);
            app.notify(t('sessions.deleted', ids.length));
            afterMutate();
            listBox.focus();
            setLevel('sessions');
          },
        );
      };
      listBox.key('x', doDelete);
      detailBox.key('x', doDelete);

      // Capture: launch a new agent session in the current folder's context.
      listBox.key('n', () => {
        launchAgent(app, { folder: state.folder }, () => {
          data.refresh();
          reloadFolders();
          reloadList();
          listBox.focus();
          app.render();
        });
      });

      // Reuse: RESUME the exact session in its original agent (claude --resume / codex resume).
      const doResume = () => {
        const r = currentRow();
        if (!r) return;
        const n = data.detail(r.id);
        resumeSession(app, { id: r.id, source: r.source, cwd: n?.cwd, projectDir: n?.projectDir }, () => {
          data.refresh();
          reloadFolders();
          reloadList();
          listBox.focus();
          setLevel('sessions');
          app.render();
        });
      };
      listBox.key('r', doResume);
      // Detail panel uses Enter instead of r — it's the leaf level, so Enter
      // (the drill-down/act key everywhere else in this view) is free here.
      detailBox.key('enter', doResume);

      // Reuse: hand the current session off to another agent (seeded NEW session).
      listBox.key('h', () => {
        const r = currentRow();
        if (!r) return;
        const hb = buildHandoff(r.id);
        if (!hb.ok) return app.notify(hb.error, 3);
        launchAgent(app, { folder: r.folder, seed: hb.prompt, parentId: r.id }, () => {
          data.refresh();
          reloadFolders();
          reloadList();
          listBox.focus();
          app.render();
        });
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
          data.refresh();
          reloadList();
          if (currentRow() && currentRow().id === id) showDetail(id);
        }
        state.selected.clear();
        reloadList();
        app.notify(t('sessions.summarizeDone', done, failed, lastError), failed ? 6 : 3);
      };
      listBox.key('a', doAutoTag);
      detailBox.key('a', doAutoTag);

      // e: hand-edit title + summary in $EDITOR (Mycelium's own record only —
      // never the original agent's log). Sticks: a later auto-tag (a) will
      // still refresh tags/decisions/todos but leaves this edit alone.
      const doEditContent = () => {
        const r = currentRow();
        if (!r) return;
        editSessionContent(app, r.id, () => {
          data.refresh();
          reloadFolders();
          reloadList();
          if (currentRow() && currentRow().id === r.id) showDetail(r.id);
          app.render();
        });
      };
      listBox.key('e', doEditContent);
      detailBox.key('e', doEditContent);

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
        app.notify(t('knowledge.generating'), 60);
        const gen = await buildKnowledgeText(state.folder);
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
function screenKey(app, keys, fn) {
  app.screen.key(keys, fn);
}

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
