import pkg from 'neo-blessed';
const blessed = pkg.default || pkg;
import { C, sourceColor } from '../theme.js';
import * as data from '../data.js';
import { t } from '../i18n.js';
import { formatSessionDetail } from '../render.js';

const MONTH_NAMES_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function ymd(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate(); // month is 1-based here
}

/**
 * Calendar tab: a second full-panel screen (Grid | Day sessions | Detail),
 * co-hosted in app.body alongside the Sessions screen's own three panels and
 * toggled via show()/hide() rather than app.show()/unmount() — swapping views
 * that way would recreate sessionsView() from scratch on the way back and
 * lose its folder/search state. Same k9s drill-down language as the Sessions
 * screen: arrows move within a panel (here: the day cursor, with live
 * preview), Enter/→ drills right, Esc/← steps back one panel.
 *
 * createCalendarTab(app, { onBack }) — onBack() is called when the grid
 * panel's Esc should return to Sessions (the `v` toggle itself is handled
 * screen-level by the caller, so it works from any of the three panels
 * without this module needing to know about it).
 * Returns { activate(), deactivate() }.
 */
export function createCalendarTab(app, { onBack }) {
  let created = false;
  let gridBox, dayListBox, calDetailBox;
  let year, month, day, counts;
  let dayRows = [];
  let level = 'grid'; // 'grid' | 'dayList' | 'detail' — which panel to refocus on activate()

  function clampDay() {
    day = Math.min(day, daysInMonth(year, month));
  }

  function loadMonth() {
    counts = data.sessionCountsByDay(year, month);
    clampDay();
  }

  function renderGrid() {
    const dim = daysInMonth(year, month);
    const firstDow = new Date(year, month - 1, 1).getDay(); // 0=Sun
    const lines = [];
    lines.push(`{bold}{${C.fox}-fg}${MONTH_NAMES_EN[month - 1]} ${year}{/}`, '');
    lines.push(`{${C.dim}-fg}Su Mo Tu We Th Fr Sa{/}`);

    let row = '  '.repeat(firstDow);
    let col = firstDow;
    for (let d = 1; d <= dim; d++) {
      const n = counts.get(d) || 0;
      const isCursor = d === day;
      let cell = pad2(d);
      if (isCursor) cell = `{${C.fox}-bg}{${C.bg}-fg}${cell}{/}`;
      else if (n > 0) cell = `{${C.spore}-fg}{bold}${cell}{/}`;
      else cell = `{${C.faint}-fg}${cell}{/}`;
      row += cell + ' ';
      col++;
      if (col === 7) {
        lines.push(row);
        row = '';
        col = 0;
      }
    }
    if (col > 0) lines.push(row);

    lines.push('');
    const n = counts.get(day) || 0;
    const dayLabel = `${MONTH_NAMES_EN[month - 1].slice(0, 3)} ${day}`;
    lines.push(`{${C.text}-fg}${dayLabel} · ${t('calendar.sessionCount', n)}{/}`);

    gridBox.setContent(lines.join('\n'));
  }

  function showCalDetail() {
    const r = dayRows[dayListBox.selected];
    calDetailBox.setContent(r ? formatSessionDetail(data.detail(r.id)).join('\n') : t('common.noContent'));
    calDetailBox.setScroll(0);
  }

  function loadDay() {
    const date = ymd(year, month, day);
    dayRows = data.sessions({ date });
    const items = dayRows.length
      ? dayRows.map((r) => {
          const name = { codex: 'codex', kiro: 'kiro' }[r.source] ?? 'claude';
          const src = `{${sourceColor(r.source)}-fg}#${name}{/}`;
          const title = (r.title || r.summary || r.preview || t('common.noContent')).replace(/\s+/g, ' ').slice(0, 60);
          return `${title}{|}${src} {${C.dim}-fg}${r.folder || t('sessions.newBadge')}{/}`;
        })
      : [`{gray-fg}${t('sessions.empty')}{/}`];
    dayListBox.setLabel(t('calendar.dayListLabel', date, dayRows.length));
    dayListBox.setItems(items);
    dayListBox.select(0);
    showCalDetail();
  }

  function renderAll() {
    renderGrid();
    loadDay();
    app.render();
  }

  function moveDay(delta) {
    const nd = day + delta;
    if (nd < 1 || nd > daysInMonth(year, month)) return;
    day = nd;
    renderAll();
  }

  function create() {
    const today = new Date();
    year = today.getFullYear();
    month = today.getMonth() + 1;
    day = today.getDate();
    counts = data.sessionCountsByDay(year, month);

    gridBox = blessed.box({
      parent: app.body,
      top: 0,
      left: 0,
      width: '28%',
      bottom: 0,
      label: t('calendar.gridLabel'),
      tags: true,
      keys: true,
      padding: { left: 1, right: 1, top: 1 },
      border: { type: 'line' },
      style: { border: { fg: C.border }, fg: C.text, focus: { border: { fg: C.fox } } },
    });
    dayListBox = blessed.list({
      parent: app.body,
      top: 0,
      left: '28%',
      width: '32%',
      bottom: 0,
      tags: true,
      keys: true,
      mouse: true,
      padding: { left: 1, right: 1 },
      scrollbar: { ch: ' ', style: { bg: C.border } },
      border: { type: 'line' },
      style: { border: { fg: C.border }, selected: { bg: C.surface, fg: C.text }, fg: C.dim, focus: { border: { fg: C.fox } } },
    });
    calDetailBox = blessed.box({
      parent: app.body,
      top: 0,
      left: '60%',
      right: 0,
      bottom: 0,
      label: t('calendar.detailLabel'),
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

    // Grid: arrows move the day cursor (live preview) — → is already taken
    // by "next day", so unlike Sessions' panels, only Enter drills right.
    gridBox.key(['left'], () => moveDay(-1));
    gridBox.key(['right'], () => moveDay(1));
    gridBox.key(['up'], () => moveDay(-7));
    gridBox.key(['down'], () => moveDay(7));
    gridBox.key(['pageup'], () => {
      month--;
      if (month < 1) {
        month = 12;
        year--;
      }
      loadMonth();
      renderAll();
    });
    gridBox.key(['pagedown'], () => {
      month++;
      if (month > 12) {
        month = 1;
        year++;
      }
      loadMonth();
      renderAll();
    });
    const drillIntoDayList = () => {
      dayListBox.focus();
      level = 'dayList';
      app.render();
    };
    gridBox.key(['enter'], drillIntoDayList);
    gridBox.key(['escape'], onBack);

    // Day list: ↑↓ live-preview the detail panel (same pattern as Sessions'
    // listBox → showDetail). Enter/→ drills into detail; Esc/← back to grid.
    dayListBox.on('keypress', (ch, key) => {
      if (key && ['up', 'down', 'k', 'j', 'pageup', 'pagedown', 'home', 'end', 'g'].includes(key.name)) {
        setImmediate(() => {
          showCalDetail();
          app.render();
        });
      }
    });
    const backToGrid = () => {
      gridBox.focus();
      level = 'grid';
      app.render();
    };
    const drillIntoCalDetail = () => {
      calDetailBox.focus();
      level = 'detail';
      app.render();
    };
    dayListBox.key(['enter', 'right'], drillIntoCalDetail);
    dayListBox.key(['escape', 'left'], backToGrid);

    // Detail: ↑↓ scroll (native, keys:true); Esc/← back to the day list.
    const backToDayList = () => {
      dayListBox.focus();
      level = 'dayList';
      app.render();
    };
    calDetailBox.key(['escape', 'left'], backToDayList);

    created = true;
  }

  function activate() {
    if (!created) create();
    else {
      // Recompute in case sessions changed while the user was on the
      // Sessions tab (move/tag/scan/etc.) — cheap, same cost as month-load.
      loadMonth();
    }
    gridBox.show();
    dayListBox.show();
    calDetailBox.show();
    renderAll();
    const focusBox = level === 'dayList' ? dayListBox : level === 'detail' ? calDetailBox : gridBox;
    focusBox.focus();
    app.setHeader(t('calendar.header'));
    app.setStatus(' ' + t('calendar.tabHint'));
    app.render();
  }

  function deactivate() {
    if (!created) return;
    gridBox.hide();
    dayListBox.hide();
    calDetailBox.hide();
  }

  return { activate, deactivate };
}
