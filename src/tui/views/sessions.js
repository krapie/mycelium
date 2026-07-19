import pkg from 'neo-blessed';
const blessed = pkg.default || pkg;
import { C, sourceColor } from '../theme.js';
import * as data from '../data.js';
import { move as organizeMove, tag as organizeTag, mkdir, renameFolder, deleteFolder, deleteSession, autoOrganize } from '../../organize.js';
import { scan } from '../../scanner.js';
import { pickFolder, editTags, menu } from '../widgets/pickers.js';
import { basename } from 'node:path';
import { launchAgent, resumeSession } from '../launch.js';
import { buildHandoff } from '../../handoff.js';
import { autoTagSession } from '../../learn.js';
import { buildKnowledgeText, writeKnowledgeText } from '../../insight.js';
import { assembleContext, injectAgentsMd } from '../../reuse.js';
import { textView, digestReader, confirmText } from '../widgets/viewers.js';
import { textPrompt } from '../widgets/pickers.js';
import { copyToClipboard } from '../clipboard.js';
import { editSessionContent } from '../widgets/editor.js';

// Plain-text rendering of a session for the clipboard (title, summary, and the
// full transcript — everything you'd want to paste elsewhere).
function sessionToText(n) {
  const L = [];
  if (n.extracted.title) L.push(`# ${n.extracted.title}`);
  L.push(`${n.source} · ${(n.startedAt || '').slice(0, 16).replace('T', ' ')} · ${n.folder || '_inbox'}`, '');
  if (n.extracted.summary) L.push('## 요약', n.extracted.summary, '');
  if (n.extracted.decisions?.length) L.push('## 결정', ...n.extracted.decisions.map((d) => `- ${d}`), '');
  if (n.extracted.todos?.length) L.push('## 할 일', ...n.extracted.todos.map((t) => `- ${t}`), '');
  if (n.artifacts.filesChanged?.length) L.push('## 파일', ...n.artifacts.filesChanged.map((f) => `- ${f}`), '');
  L.push('## 대화');
  for (const t of n.turns) L.push(`[${t.role}] ${t.text}`, '');
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
    const { list, counts, inbox, total } = data.folders();
    const items = [`{${state.folder === null ? C.fox : C.dim}-fg}전체 (${total}){/}`];
    const keys = [null];
    if (inbox) {
      items.push(`{${state.folder === '_inbox' ? C.fox : C.dim}-fg}_inbox (${inbox}){/}`);
      keys.push('_inbox');
    }
    for (const f of list) {
      const depth = Math.min(f.split('/').length - 1, 4);
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
      const human = r.organizedBy === 'human' ? `{${C.spore}-fg}[사람]{/}` : '';
      const mark = state.selected.has(r.id) ? `{${C.fox}-fg}✓{/}` : ' ';
      const tags = (r.tags || []).map((t) => `{${C.fox}-fg}#${t}{/}`).join(' ');
      const link = r.continuationOf ? `{${C.spore}-fg}↩{/}` : (r.continuedTo && r.continuedTo.length) ? `{${C.spore}-fg}→{/}` : ' ';
      const text = (r.title || r.summary || r.preview || '(내용 없음)').replace(/\s+/g, ' ').slice(0, 58);
      return `${mark}${link}${src}  ${text} ${tags} ${human}`;
    });
    listBox.setItems(items.length ? items : ['{gray-fg}세션 없음{/}']);
    updateHeader();
  }

  function updateHeader() {
    const crumb = state.folder || '전체';
    const filt = [state.query && `/${state.query}`, ...state.tags.map((t) => `#${t}`)].filter(Boolean).join(' ');
    app.setHeader(`${crumb}${filt ? '  {' + C.spore + '-fg}' + filt + '{/}' : ''}`, `${rows.length} sessions`);
  }

  function showDetail(id) {
    const n = data.detail(id);
    if (!n) return;
    const lines = [];
    const srcName = n.source === 'codex' ? 'codex' : 'claude';
    // Title as the headline, then metadata, then the description (summary).
    if (n.extracted.title) {
      const human = n.extracted.editedByHuman ? ` {${C.spore}-fg}[편집됨]{/}` : '';
      lines.push(`{${C.fox}-fg}{bold}${n.extracted.title}{/}${human}`);
    }
    lines.push(`{${sourceColor(n.source)}-fg}${srcName}{/}  {${C.dim}-fg}${(n.startedAt || '').slice(0, 16).replace('T', ' ')} · ${n.folder || '_inbox'}{/}`);
    lines.push('');
    if (n.extracted.summary) {
      lines.push(`{${C.text}-fg}${n.extracted.summary}{/}`, '');
    } else {
      lines.push(`{${C.faint}-fg}(요약 없음 — 세션에서 a를 눌러 요약·태깅 생성){/}`, '');
      const firstUser = n.turns.find((t) => t.role === 'user')?.text;
      if (firstUser) lines.push(`{${C.faint}-fg}첫 요청:{/} ${firstUser.replace(/\s+/g, ' ').slice(0, 300)}`, '');
    }
    if (n.extracted.decisions?.length) lines.push(`{${C.faint}-fg}결정{/}`, ...n.extracted.decisions.map((d) => `  · ${d}`), '');
    if (n.extracted.todos?.length) lines.push(`{${C.faint}-fg}할일{/}`, ...n.extracted.todos.map((t) => `  · ${t}`), '');
    if (n.artifacts.filesChanged?.length) lines.push(`{${C.faint}-fg}파일{/} ${n.artifacts.filesChanged.slice(0, 10).join(', ')}`);
    // Handoff continuation links (this is one flow across a model switch).
    if (n.continuationOf) {
      const p = data.detail(n.continuationOf);
      lines.push('', `{${C.spore}-fg}↩ 이어받음: ${p ? p.source + ' #' + n.continuationOf.slice(0, 8) : '#' + n.continuationOf.slice(0, 8)}{/}`);
    }
    for (const cid of n.continuedTo || []) {
      const c = data.detail(cid);
      lines.push(`{${C.spore}-fg}→ 이어감: ${c ? c.source + ' #' + cid.slice(0, 8) : '#' + cid.slice(0, 8)}{/}`);
    }
    detailBox.setContent(lines.join('\n'));
    detailBox.setScroll(0);
    app.render();
  }

  function currentRow() {
    return rows[listBox.selected];
  }

  return {
    help: '</>검색 <s>스캔+정리 <n>새세션 <r>이어열기 <h>핸드오프 <m>이동 <t>태그 <a>요약 <e>편집 <x>삭제 <d>다이제스트 <c>컨텍스트 <i>주입 <w>지식 <q>종료',
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

      // Folder names are short, so the folder column is a FIXED-width sidebar
      // (not a %, which would keep growing on wide terminals). The remaining
      // width is split between sessions and detail — detail gets more (it holds
      // the transcript), and whichever of the two is focused gets a bit more.
      const applyLayout = (lvl) => {
        const W = app.screen.width || 120;
        const foldersW = Math.min(30, Math.max(18, Math.round(W * 0.14)));
        const rest = W - foldersW;
        const sessionFrac = lvl === 'sessions' ? 0.5 : lvl === 'detail' ? 0.34 : 0.42;
        const sessionsW = Math.max(22, Math.round(rest * sessionFrac));
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
        const hints = {
          folders: '{bold}폴더{/}: ↑↓  Enter 열기  <a>새폴더  <e>이름변경  <m>이동/중첩  <x>삭제  <w>지식  <s>스캔+정리  </>검색  <q>종료',
          sessions: '{bold}세션{/}: ↑↓  Enter 상세  Esc 폴더로  <a>요약  <e>편집  <y>복사  <r>이어열기  <h>핸드오프  <m>이동  <t>태그  <x>삭제  <w>지식  <d>다이제스트  <s>스캔+정리  <Space>선택',
          detail: '{bold}상세{/}: ↑↓ 스크롤  Esc 세션으로  <a>요약  <e>편집  <y>복사  <r>이어열기  <x>삭제  <s>스캔+정리',
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
      const isRealFolder = (f) => f && f !== '_inbox';
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
        prompt(app, `새 폴더 이름${parent ? ` (${parent} 아래)` : ' (루트)'}`, '', (name) => {
          foldersBox.focus();
          if (!name || !name.trim()) return;
          const path = (parent ? parent + '/' : '') + name.trim().replace(/^\/+|\/+$/g, '');
          mkdir(path);
          app.notify(`폴더 생성: ${path}`);
          refreshFolders(path);
        });
      });

      // e: rename the selected folder.
      foldersBox.key('e', () => {
        const f = curFolder();
        if (!isRealFolder(f)) return app.notify('일반/_inbox는 이름을 바꿀 수 없습니다', 3);
        prompt(app, `이름 변경: ${f}`, f, (val) => {
          foldersBox.focus();
          if (!val || val.trim() === f) return;
          const res = renameFolder(f, val.trim().replace(/^\/+|\/+$/g, ''));
          app.notify(res.ok ? `이름 변경: ${res.to}` : res.error, res.ok ? 2 : 3);
          refreshFolders(res.ok ? res.to : f);
        });
      });

      // m: move (re-nest) the selected folder into another folder.
      foldersBox.key('m', () => {
        const f = curFolder();
        if (!isRealFolder(f)) return app.notify('일반/_inbox는 옮길 수 없습니다', 3);
        pickFolder(app, (dest) => {
          foldersBox.focus();
          if (dest === undefined) return;
          const target = (dest ? dest + '/' : '') + basename(f);
          const res = renameFolder(f, target);
          app.notify(res.ok ? `이동: ${res.to}` : res.error, res.ok ? 2 : 3);
          refreshFolders(res.ok ? res.to : f);
        });
      });

      // x: delete the selected folder (sessions → _inbox).
      foldersBox.key('x', () => {
        const f = curFolder();
        if (!isRealFolder(f)) return app.notify('일반/_inbox는 삭제할 수 없습니다', 3);
        menu(app, `"${f}" 삭제?`, [
          { label: '삭제 (세션은 _inbox로)', value: 'yes' },
          { label: '취소', value: 'no' },
        ], (ans) => {
          foldersBox.focus();
          if (ans !== 'yes') return;
          const res = deleteFolder(f);
          app.notify(res.ok ? `삭제됨 (세션 ${res.moved}개 → _inbox)` : res.error);
          state.folder = null;
          refreshFolders(null);
        });
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

      // Live search.
      screenKey(app, ['/'], () => {
        prompt(app, '검색', state.query, (val) => {
          state.query = (val || '').trim();
          reloadList();
          listBox.focus();
          app.render();
        });
      });

      // s: scan (capture new/changed sessions from every tab/terminal) +
      // organize (auto-file by cwd rule, sticky — never touches sessions a
      // human already filed) + reindex, all in one, without leaving the TUI.
      // Mirrors `mycelium scan && mycelium organize`.
      screenKey(app, ['s'], () => {
        app.notify('스캔 중…', 30);
        setImmediate(() => {
          let s, o;
          try {
            s = scan();
            o = autoOrganize();
          } catch (err) {
            app.notify(`스캔 실패: ${err.message}`, 4);
            return;
          }
          data.refresh();
          reloadFolders();
          reloadList();
          app.notify(
            `스캔 +${s.imported} (총 ${s.scanned}, 건너뜀 ${s.skipped}${s.failed ? `, 실패 ${s.failed}` : ''}) · 자동배치 ${o.placed}개 (사람 정리 ${o.skippedHuman}개 보존)`,
            5,
          );
          app.render();
        });
      });

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
          app.notify(`${ids.length}개 세션 → ${folder || '_inbox'}`);
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
          app.notify(`${ids.length}개 세션 태그 갱신`);
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
          `${ids.length}개 세션 삭제? (Mycelium에서만 삭제, 원본 로그는 유지)`,
          [
            { label: '삭제', value: 'yes' },
            { label: '취소', value: 'no' },
          ],
          (ans) => {
            if (ans !== 'yes') return listBox.focus();
            for (const id of ids) deleteSession(id);
            app.notify(`${ids.length}개 세션 삭제됨`);
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
      detailBox.key('r', doResume);

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
        for (const id of ids) {
          app.notify(`요약·태깅 생성 중… (${done + 1}/${ids.length})`, 90);
          const res = await autoTagSession(id);
          if (res.ok) done++;
          else failed++;
          data.refresh();
          reloadList();
          if (currentRow() && currentRow().id === id) showDetail(id);
        }
        state.selected.clear();
        reloadList();
        app.notify(`요약·태깅 완료: ${done}개${failed ? ` (실패 ${failed})` : ''}`, 3);
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
        app.notify(ok ? '세션 내용을 클립보드에 복사함' : '복사 도구(pbcopy 등)를 찾지 못함', ok ? 2 : 3);
      };
      listBox.key('y', doCopy);
      detailBox.key('y', doCopy);

      // w: extract KNOWLEDGE.md for the current folder — generate, show the
      // human what it's about to write (it feeds AGENTS.md for every future
      // session in this folder), and only save on explicit confirm.
      const doKnowledge = async () => {
        if (!state.folder || state.folder === '_inbox') return app.notify('폴더를 먼저 선택하세요', 3);
        const refocus = () => (state.level === 'folders' ? foldersBox : listBox).focus();
        app.notify('지식 초안 생성 중…', 60);
        const gen = await buildKnowledgeText(state.folder);
        if (!gen.ok) {
          app.notify(gen.error, 3);
          return refocus();
        }
        confirmText(app, `KNOWLEDGE.md 미리보기 · ${state.folder}`, gen.text, (ok) => {
          if (!ok) {
            app.notify('취소됨 — KNOWLEDGE.md 변경 없음', 2);
            return refocus();
          }
          const w = writeKnowledgeText(state.folder, gen.text);
          app.notify(w.ok ? `KNOWLEDGE.md 저장: ${state.folder}` : w.error, 3);
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
        textView(app, `컨텍스트 · ${r.folder || '_inbox'}`, ctx || '(상속할 컨텍스트 없음)');
      });
      // i: inject the folder's KNOWLEDGE.md into a directory's AGENTS.md —
      // show exactly what will be written before touching that file.
      listBox.key('i', () => {
        const r = currentRow();
        if (!r || !r.folder) return app.notify('폴더가 있는 세션에서만 가능합니다', 3);
        textPrompt(app, 'AGENTS.md를 주입할 디렉토리', process.cwd(), (dir) => {
          if (!dir) return listBox.focus();
          const ctx = assembleContext(r.folder);
          if (!ctx) {
            app.notify(`주입할 KNOWLEDGE.md가 없습니다: ${r.folder}`, 3);
            return listBox.focus();
          }
          confirmText(app, `${dir.trim()}/AGENTS.md 에 주입할 내용`, ctx, (ok) => {
            if (!ok) {
              app.notify('취소됨 — AGENTS.md 변경 없음', 2);
              return listBox.focus();
            }
            const res = injectAgentsMd(dir.trim(), r.folder);
            app.notify(res.ok ? `AGENTS.md 주입: ${dir.trim()}` : res.error, 3);
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
