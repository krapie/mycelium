import pkg from 'neo-blessed';
const blessed = pkg.default || pkg;
import { C, sourceColor } from '../theme.js';
import * as data from '../data.js';

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
    help: '<Tab>패널 </>검색 <n>새세션 <m>이동 <t>태그 <Space>선택 <h>핸드오프 <:>명령 <q>종료',
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
