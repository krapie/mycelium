import pkg from 'neo-blessed';
const blessed = pkg.default || pkg;
import { C, sourceColor } from '../theme.js';
import * as data from '../data.js';
import { move as organizeMove, tag as organizeTag } from '../../organize.js';
import { pickFolder, editTags } from '../widgets/pickers.js';
import { launchAgent } from '../launch.js';
import { buildHandoff } from '../../handoff.js';
import { autoTagSession } from '../../learn.js';
import { generateDigest, extractKnowledge } from '../../insight.js';
import { assembleContext, injectAgentsMd } from '../../reuse.js';
import { textView, digestReader } from '../widgets/viewers.js';
import { textPrompt } from '../widgets/pickers.js';

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
      const dot = `{${sourceColor(r.source)}-fg}●{/}`;
      const human = r.organizedBy === 'human' ? `{${C.spore}-fg}[사람]{/}` : '';
      const mark = state.selected.has(r.id) ? `{${C.fox}-fg}✓{/}` : ' ';
      const tags = (r.tags || []).map((t) => `{${C.fox}-fg}#${t}{/}`).join(' ');
      const text = (r.summary || r.preview || '(내용 없음)').replace(/\s+/g, ' ').slice(0, 60);
      return `${mark} ${dot} {${C.faint}-fg}${r.id.slice(0, 8)}{/} ${text} ${tags} ${human}`;
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
    lines.push(`{${C.fox}-fg}{bold}${(n.extracted.summary || n.turns.find((t) => t.role === 'user')?.text || n.id).slice(0, 70)}{/}`);
    lines.push(`{${C.dim}-fg}${n.source} · ${n.id.slice(0, 8)} · ${(n.startedAt || '').slice(0, 16).replace('T', ' ')} · ${n.folder || '_inbox'}{/}`);
    lines.push('');
    if (n.extracted.summary) lines.push(`{${C.faint}-fg}요약{/} ${n.extracted.summary}`, '');
    if (n.extracted.decisions?.length) lines.push(`{${C.faint}-fg}결정{/}`, ...n.extracted.decisions.map((d) => `  · ${d}`), '');
    if (n.extracted.todos?.length) lines.push(`{${C.faint}-fg}할일{/}`, ...n.extracted.todos.map((t) => `  · ${t}`), '');
    if (n.artifacts.filesChanged?.length) lines.push(`{${C.faint}-fg}파일{/} ${n.artifacts.filesChanged.slice(0, 8).join(', ')}`, '');
    lines.push(`{${C.faint}-fg}대화{/}`);
    for (const t of n.turns.slice(0, 40)) {
      const role = t.role === 'user' ? `{${C.fox}-fg}▸ user{/}` : `{${C.dim}-fg}  asst{/}`;
      lines.push(`${role} ${t.text.replace(/\s+/g, ' ').slice(0, 200)}`);
    }
    detailBox.setContent(lines.join('\n'));
    detailBox.setScroll(0);
    app.render();
  }

  function currentRow() {
    return rows[listBox.selected];
  }

  return {
    help: '</>검색 <n>새세션 <m>이동 <t>태그 <A>태깅 <h>핸드오프 <D>다이제스트 <d>보기 <c>컨텍스트 <i>주입 <K>지식 <q>종료',
    async mount(a) {
      app = a;
      foldersBox = blessed.list({
        parent: app.body,
        top: 0,
        left: 0,
        width: 28,
        bottom: 0,
        label: ' Folders ',
        tags: true,
        keys: true,
        border: { type: 'line' },
        style: { border: { fg: C.border }, selected: { bg: C.surface }, fg: C.dim },
      });
      listBox = blessed.list({
        parent: app.body,
        top: 0,
        left: 28,
        right: 0,
        height: '55%',
        label: ' Sessions ',
        tags: true,
        keys: true,
        scrollbar: { ch: ' ', style: { bg: C.border } },
        border: { type: 'line' },
        style: { border: { fg: C.border }, selected: { bg: C.surface, fg: C.text }, fg: C.dim },
      });
      detailBox = blessed.box({
        parent: app.body,
        left: 28,
        right: 0,
        top: '55%',
        bottom: 0,
        label: ' Detail ',
        tags: true,
        scrollable: true,
        alwaysScroll: true,
        keys: true,
        mouse: true,
        scrollbar: { ch: ' ', style: { bg: C.border } },
        border: { type: 'line' },
        style: { border: { fg: C.border }, fg: C.text },
      });

      reloadFolders();
      reloadList();
      app.setStatus(this.help);

      foldersBox.on('select', () => {
        state.folder = foldersBox._keys[foldersBox.selected];
        reloadFolders();
        reloadList();
        app.render();
      });
      listBox.on('select item', () => {
        const r = currentRow();
        if (r) showDetail(r.id);
      });
      listBox.key('enter', () => detailBox.focus());
      detailBox.key(['escape', 'q'], () => listBox.focus());

      // Tab cycles panes.
      const panes = [foldersBox, listBox, detailBox];
      let pi = 1;
      screenKey(app, ['tab'], () => {
        pi = (pi + 1) % panes.length;
        panes[pi].focus();
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

      // Reuse: hand the current session off to another agent (seeded continuation).
      listBox.key('h', () => {
        const r = currentRow();
        if (!r) return;
        const hb = buildHandoff(r.id);
        if (!hb.ok) return app.notify(hb.error, 3);
        launchAgent(app, { folder: r.folder, seed: hb.prompt }, () => {
          data.refresh();
          reloadFolders();
          reloadList();
          listBox.focus();
          app.render();
        });
      });

      // Learn: auto-tag the current session (content-based).
      listBox.key('A', async () => {
        const r = currentRow();
        if (!r) return;
        app.notify('태깅 중…', 30);
        const res = await autoTagSession(r.id);
        if (res.ok) {
          data.refresh();
          reloadList();
          showDetail(r.id);
          app.notify(`#${res.session.extracted.tags.join(' #') || '(태그 없음)'}`);
        } else app.notify(res.error, 3);
      });

      // Learn: extract KNOWLEDGE.md for the current folder.
      listBox.key('K', async () => {
        if (!state.folder || state.folder === '_inbox') return app.notify('폴더를 먼저 선택하세요', 3);
        app.notify('지식 추출 중…', 60);
        const res = await extractKnowledge(state.folder);
        app.notify(res.ok ? `KNOWLEDGE.md 생성: ${state.folder}` : res.error, 3);
      });

      // Learn: generate a digest (day, or `week`).
      screenKey(app, ['D'], () => {
        textPrompt(app, "다이제스트 기간 (빈칸=오늘, 'week'=이번주, 날짜 YYYY-MM-DD)", '', async (v) => {
          listBox.focus();
          const arg = (v || '').trim();
          const period = arg === 'week' ? 'week' : 'day';
          const date = /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : undefined;
          app.notify('다이제스트 생성 중…', 60);
          const res = await generateDigest({ period, date });
          if (res.ok) {
            app.notify(`생성: ${res.keyed}`);
            digestReader(app);
          } else app.notify(res.error, 3);
        });
      });

      // Learn/Reuse read-only: digest reader, context, inject.
      screenKey(app, ['d'], () => digestReader(app));
      listBox.key('c', () => {
        const r = currentRow();
        if (!r) return;
        const ctx = assembleContext(r.folder);
        textView(app, `컨텍스트 · ${r.folder || '_inbox'}`, ctx || '(상속할 컨텍스트 없음)');
      });
      listBox.key('i', () => {
        const r = currentRow();
        if (!r || !r.folder) return app.notify('폴더가 있는 세션에서만 가능합니다', 3);
        textPrompt(app, 'AGENTS.md를 주입할 디렉토리', process.cwd(), (dir) => {
          listBox.focus();
          if (!dir) return;
          const res = injectAgentsMd(dir.trim(), r.folder);
          app.notify(res.ok ? `AGENTS.md 주입: ${dir.trim()}` : res.error, 3);
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

      listBox.focus();
      if (rows[0]) showDetail(rows[0].id);
    },
    unmount() {},
  };
}

// Attach a screen-level key without leaking across view swaps.
function screenKey(app, keys, fn) {
  app.screen.key(keys, fn);
}

// Simple modal text prompt.
export function prompt(app, label, initial, cb) {
  const p = blessed.prompt({
    parent: app.screen,
    top: 'center',
    left: 'center',
    width: '60%',
    height: 'shrink',
    border: { type: 'line' },
    label: ` ${label} `,
    tags: true,
    style: { border: { fg: C.fox }, fg: C.text },
  });
  p.input(label, initial || '', (err, val) => {
    p.destroy();
    app.render();
    if (!err) cb(val);
  });
}
