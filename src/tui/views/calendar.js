import pkg from 'neo-blessed';
const blessed = pkg.default || pkg;
import { C, sourceColor, sourceLabel } from '../theme.js';
import * as data from '../data.js';
import { t } from '../i18n.js';
import { formatSessionDetail } from '../render.js';
import { createResumeHandoff } from '../resume-handoff.js';

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

    // 3 columns per day ("dd "), matching the Su/Mo/... header's own stride —
    // this used to pad 2 per skipped weekday, which slid every day in the
    // first week one column left of the weekday it actually falls on.
    let row = '   '.repeat(firstDow);
    let col = firstDow;
    for (let d = 1; d <= dim; d++) {
      const n = counts.get(d) || 0;
      const isCursor = d === day;
      let cell = pad2(d);
      // A day with no sessions never gets the filled "highlighted" look, even
      // when it's the cursor (e.g. today, right after opening the calendar,
      // before it has anything in it yet) — that read as "this day has a
      // session" at a glance, which it didn't. The cursor still needs SOME
      // marker so you don't lose your place navigating through empty days,
      // just a much quieter one: an underline (no width change, unlike
      // brackets, so the 7-column grid stays aligned) instead of a fill.
      if (isCursor && n > 0) cell = `{${C.fox}-bg}{${C.bg}-fg}${cell}{/}`;
      else if (n > 0) cell = `{${C.spore}-fg}{bold}${cell}{/}`;
      else if (isCursor) cell = `{${C.faint}-fg}{underline}${cell}{/underline}{/}`;
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
          const src = `{${sourceColor(r.source)}-fg}#${sourceLabel(r.source)}{/}`;
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

  // Move the day cursor by delta days, rolling into the adjacent month when
  // it crosses a month boundary (e.g. ↓ from the last week lands in the next
  // month, ↑ from the first week in the previous one). Date does the
  // month/year normalization; when the month actually changes we reload its
  // session counts. day is always a real day of the resulting month, so
  // loadMonth()'s clampDay() is a no-op here.
  function moveDay(delta) {
    const d = new Date(year, month - 1, day + delta);
    const ny = d.getFullYear();
    const nm = d.getMonth() + 1;
    day = d.getDate();
    if (nm !== month || ny !== year) {
      year = ny;
      month = nm;
      loadMonth();
    }
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
      // Not `mouse: true`: on a non-scrollable box that only wires
      // wheel-scrolling, which there's nothing here to scroll. `clickable`
      // is what puts it in screen.clickable, so a click focuses this panel
      // like it does the other two (issue #68). Clicking an individual DAY
      // cell is deliberately NOT supported: the grid is hand-rendered text,
      // so it would need pixel→day hit-testing against renderGrid()'s exact
      // layout — a different kind of change from letting blessed's own list
      // widgets handle clicks, and the arrow keys already reach every day.
      clickable: true,
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

    // `level` is which of the three panels has focus (activate() refocuses
    // by it after a tab switch), so derive it from the panels themselves
    // rather than only from the drill/back helpers below — a click focuses
    // whatever it lands on without going through any of them (issue #68).
    gridBox.on('focus', () => (level = 'grid'));
    dayListBox.on('focus', () => (level = 'dayList'));
    calDetailBox.on('focus', () => (level = 'detail'));

    // Grid: arrows move the day cursor (live preview) — → is already taken
    // by "next day", so unlike Sessions' panels, only Enter drills right.
    // ←→ ±1 day, ↑↓ ±1 week; both roll into the adjacent month at the edges
    // (moveDay). PgUp/PgDn jump a whole month, keeping the same day-of-month.
    const changeMonth = (delta) => {
      month += delta;
      if (month < 1) {
        month = 12;
        year--;
      } else if (month > 12) {
        month = 1;
        year++;
      }
      loadMonth();
      renderAll();
    };
    gridBox.key(['left'], () => moveDay(-1));
    gridBox.key(['right'], () => moveDay(1));
    gridBox.key(['up'], () => moveDay(-7));
    gridBox.key(['down'], () => moveDay(7));
    gridBox.key(['pageup'], () => changeMonth(-1));
    gridBox.key(['pagedown'], () => changeMonth(1));
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
    // Mouse: same rule as the Sessions panel's own lists (see sessions.js) —
    // click/wheel move the cursor, a click on the row already under it
    // activates, and `select` (not key('enter')) is what Enter and
    // click-to-activate share so they can't drift.
    const previewCalRow = () => {
      showCalDetail();
      app.render();
    };
    for (const ev of ['element click', 'element wheeldown', 'element wheelup']) {
      dayListBox.on(ev, previewCalRow);
    }
    dayListBox.on('select', drillIntoCalDetail);
    dayListBox.key(['right'], drillIntoCalDetail);
    dayListBox.key(['escape', 'left'], backToGrid);

    // Resume/handoff/copy-command trio — shared with the Sessions panel's
    // listBox/detailBox (see resume-handoff.js). Only the "what's currently
    // selected" accessor and the post-action callback are view-specific;
    // both resume and handoff use the same afterAction() here (unlike
    // sessions.js, which returns to a different level after each).
    const afterAction = () => {
      loadMonth();
      renderAll();
      dayListBox.focus();
      level = 'dayList';
      app.render();
    };
    const { doResume, doHandoff, onDetailEnter } = createResumeHandoff(app, {
      getCurrentRow: () => dayRows[dayListBox.selected],
      afterResume: afterAction,
      afterHandoff: afterAction,
    });
    dayListBox.key('r', doResume);
    dayListBox.key('h', () => doHandoff());

    // Detail: ↑↓ scroll (native, keys:true); Esc/← back to the day list;
    // Enter opens the same "resume here / copy command" choice as the
    // Sessions screen's detail panel.
    const backToDayList = () => {
      dayListBox.focus();
      level = 'dayList';
      app.render();
    };
    calDetailBox.key(['escape', 'left'], backToDayList);
    calDetailBox.key('enter', onDetailEnter);

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
