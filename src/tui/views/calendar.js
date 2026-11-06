/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

import pkg from 'neo-blessed';
const blessed = pkg.default || pkg;
import { C, sourceColor, sourceLabel } from '../theme.js';
import * as data from '../data.js';
import { t } from '../i18n.js';
import { formatSessionDetail } from '../render.js';
import { createResumeHandoff } from '../resume-handoff.js';
import {
  move as organizeMove,
  tag as organizeTag,
  deleteSession,
  setContent,
} from '../../organize.js';
import { pickFolder, editTags, menu, textPrompt, multiSelectList } from '../widgets/pickers.js';
import { copyToClipboard } from '../clipboard.js';
import { autoTagSession } from '../../learn.js';
import { mapConcurrent } from '../../llm.js';
import { createClip } from '../../clip.js';
import { sessionToText } from './sessions.js';
import * as actions from './sessions-actions.js';

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
  const selected = new Set();
  let level = 'grid'; // 'grid' | 'dayList' | 'detail' — which panel to refocus on activate()
  let sortBy = 'recent';

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
    calDetailBox.setContent(
      r ? formatSessionDetail(data.detail(r.id), { thisMachine: data.machines()?.thisMachine }).join('\n') : t('common.noContent'),
    );
    calDetailBox.setScroll(0);
  }

  function loadDay() {
    const date = ymd(year, month, day);
    let rows = data.sessions({ date });
    if (sortBy === 'date-asc') {
      rows.sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''));
    } else if (sortBy === 'title') {
      rows.sort((a, b) => (a.title || a.summary || '').localeCompare(b.title || b.summary || ''));
    } else if (sortBy === 'title-desc') {
      rows.sort((a, b) => (b.title || b.summary || '').localeCompare(a.title || a.summary || ''));
    } else if (sortBy === 'agent') {
      rows.sort((a, b) => (a.source || '').localeCompare(b.source || ''));
    }
    dayRows = rows;
    const machines = data.machines();
    const items = dayRows.length
      ? dayRows.map((r) => {
          const mark = selected.has(r.id) ? `{${C.fox}-fg}✓{/} ` : '';
          const src = `{${sourceColor(r.source)}-fg}#${sourceLabel(r.source)}{/}`;
          // Same @machine badge as the Sessions list, on a store synced across machines.
          const host = machines && r.host ? `{${r.host === machines.thisMachine ? C.faint : C.host}-fg}@${r.host.slice(0, 12)}{/} ` : '';
          const title = (r.title || r.summary || r.preview || t('common.noContent')).replace(/\s+/g, ' ').slice(0, 60);
          return `${mark}${title}{|}${host}${src} {${C.dim}-fg}${r.folder || t('sessions.newBadge')}{/}`;
        })
      : [`{gray-fg}${t('sessions.empty')}{/}`];
    dayListBox.setLabel(t('calendar.dayListLabel', date, dayRows.length));
    const prev = dayListBox.selected ?? 0;
    dayListBox.setItems(items);
    if (dayRows.length) dayListBox.select(Math.min(prev, dayRows.length - 1));
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
    selected.clear();
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
    // ←→ ±1 day, ↑↓ ±1 week; both roll into the adjacent month at the edges
    // (moveDay). PgUp/PgDn jump a whole month, keeping the same day-of-month.
    const changeMonth = (delta) => {
      selected.clear();
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
    dayListBox.key(['enter', 'right'], drillIntoCalDetail);
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

    const currentRow = () => dayRows[dayListBox.selected];
    const targets = () => (selected.size ? [...selected] : currentRow() ? [currentRow().id] : []);

    const afterMutate = (ids) => {
      selected.clear();
      data.refreshMany(ids);
      loadMonth();
      renderAll();
      dayListBox.focus();
      level = 'dayList';
      app.render();
    };

    // Organize: move to folder
    dayListBox.key('m', () => {
      const ids = targets();
      if (!ids.length) return;
      pickFolder(app, (folder) => {
        if (folder === undefined) return dayListBox.focus();
        for (const id of ids) organizeMove(id, folder);
        app.notify(t('sessions.movedTo', ids.length, folder || t('sessions.newBadge')));
        afterMutate(ids);
        dayListBox.focus();
      });
    });

    // Organize: edit tags
    dayListBox.key('t', () => {
      const ids = targets();
      if (!ids.length) return;
      const cur = ids.length === 1 ? data.detail(ids[0])?.extracted.tags || [] : [];
      editTags(app, cur, (edit) => {
        if (!edit) return dayListBox.focus();
        for (const id of ids) organizeTag(id, edit.add, edit.remove);
        app.notify(t('sessions.tagsUpdated', ids.length));
        afterMutate(ids);
        dayListBox.focus();
      });
    });

    // Organize: delete
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
          if (ans !== 'yes') return dayListBox.focus();
          const touched = new Set(ids);
          for (const id of ids) for (const otherId of deleteSession(id).touchedIds || []) touched.add(otherId);
          app.notify(t('sessions.deleted', ids.length));
          afterMutate([...touched]);
          dayListBox.focus();
          level = 'dayList';
        },
      );
    };
    dayListBox.key('x', doDelete);
    calDetailBox.key('x', doDelete);

    // Learn: auto-tag
    const doAutoTag = async () => {
      const ids = targets();
      if (!ids.length) return;
      let done = 0;
      let failed = 0;
      let lastError = null;
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
          failed++;
          lastError = err.message;
        }
        spin.update(t('sessions.summarizing', done + failed, ids.length));
        data.refreshOne(id);
        loadDay();
        if (currentRow() && currentRow().id === id) showCalDetail();
      });
      spin.stop();
      selected.clear();
      loadMonth();
      renderAll();
      app.notify(t('sessions.summarizeDone', done, failed, lastError), failed ? 6 : 3);
    };
    dayListBox.key('a', doAutoTag);
    calDetailBox.key('a', doAutoTag);

    // Edit title
    const doEditTitle = () => {
      const r = currentRow();
      if (!r) return;
      const n = data.detail(r.id);
      const save = (fields) => {
        const res = setContent(r.id, fields);
        app.notify(res.ok ? t('editor.saved') : t('editor.saveFailed', res.error), res.ok ? 2 : 3);
        data.refreshOne(r.id);
        loadMonth();
        renderAll();
        if (currentRow() && currentRow().id === r.id) showCalDetail();
        app.render();
      };
      textPrompt(app, t('editor.titlePrompt'), n?.extracted.title || '', (val) => {
        if (val === null) return;
        if (r.kind !== 'backlog') return save({ title: val });
        textPrompt(app, t('editor.descPrompt'), n?.extracted.summary || '', (desc) => {
          save(desc === null ? { title: val } : { title: val, summary: desc });
        });
      });
    };
    dayListBox.key('e', doEditTitle);
    calDetailBox.key('e', doEditTitle);

    // Copy to clipboard
    const doCopy = () => {
      const r = currentRow();
      if (!r) return;
      const n = data.detail(r.id);
      if (!n) return;
      const ok = copyToClipboard(sessionToText(n));
      app.notify(ok ? t('sessions.copied') : t('sessions.copyFailed'), ok ? 2 : 3);
    };
    dayListBox.key('y', doCopy);
    calDetailBox.key('y', doCopy);

    // Pin clip
    const doClip = () => {
      const r = currentRow();
      if (!r) return;
      const refocus = () => (level === 'detail' ? calDetailBox : dayListBox).focus();
      const n = data.detail(r.id);
      if (!n?.turns?.length) return app.notify(t('clip.noTurns'), 3);
      const items = n.turns.map((turn) => {
        const preview = (turn.text || '').replace(/\s+/g, ' ').slice(0, 60);
        return `[${turn.role}] ${preview}`;
      });
      multiSelectList(app, t('clip.selectTurns'), items, (picked) => {
        if (!picked || !picked.length) return refocus();
        const from = picked[0] + 1;
        const to = picked[picked.length - 1] + 1;
        textPrompt(app, t('clip.notePrompt'), '', (note) => {
          if (note === null) return refocus();
          const res = createClip({ sessionId: r.id, from, to, note });
          app.notify(res.ok ? t('clip.saved') : res.error, 3);
          refocus();
        });
      });
    };
    dayListBox.key('p', doClip);

    // Multi-selection with space and *
    dayListBox.key('space', () => {
      const r = currentRow();
      if (!r) return;
      if (selected.has(r.id)) selected.delete(r.id);
      else selected.add(r.id);
      loadDay();
      app.render();
    });

    dayListBox.key('*', () => {
      if (!dayRows.length) return;
      const allSelected = dayRows.every((r) => selected.has(r.id));
      for (const r of dayRows) {
        if (allSelected) selected.delete(r.id);
        else selected.add(r.id);
      }
      loadDay();
      app.render();
    });

    // Shift+O: cycle sort
    const SORT_CYCLE = ['recent', 'title', 'agent'];
    dayListBox.key('S-o', () => {
      const i = SORT_CYCLE.indexOf(sortBy);
      sortBy = SORT_CYCLE[(i + 1) % SORT_CYCLE.length];
      loadDay();
      app.render();
    });

    // Shift+T: sort picker
    dayListBox.key('S-t', () => {
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
          dayListBox.focus();
          if (val === undefined) return;
          sortBy = val;
          loadDay();
          app.render();
        },
      );
    });

    // Context for sessions-actions (doMerge, doSplit)
    const actionCtx = {
      app,
      state: { selected },
      listBox: dayListBox,
      currentRow,
      reloadFolders: () => loadMonth(),
      reloadList: () => renderAll(),
    };

    // Shift+M: merge
    dayListBox.key('S-m', () => actions.doMerge(actionCtx));

    // Shift+S: split
    dayListBox.key('S-s', () => actions.doSplit(actionCtx));

    // .: action menu
    function openActionMenu() {
      if (level === 'detail') return;

      const hint = (k) => `  {${C.text}-fg}(${k}){/}`;
      const items = [];
      const r = currentRow();
      if (r) {
        const multi = selected.size > 1;
        const sessionItems = [];
        sessionItems.push({ label: `${t('actions.handoff')}${hint('h')}`, value: () => doHandoff() });
        sessionItems.push({ label: `${t('actions.lineage')}${hint('Enter')}`, value: drillIntoCalDetail });
        sessionItems.push({ label: `${t('actions.split')}${hint('Shift+S')}`, value: () => actions.doSplit(actionCtx) });
        sessionItems.push({ label: `${t('actions.clip')}${hint('p')}`, value: doClip });
        if (multi) sessionItems.push({ label: `${t('actions.merge')}${hint('Shift+M')}`, value: () => actions.doMerge(actionCtx) });
        items.push({ header: true, label: t('actions.groupSession') });
        items.push(...sessionItems);
      }
      if (!items.length) return;
      menu(
        app,
        t('actions.title'),
        items,
        (fn) => {
          if (typeof fn === 'function') fn();
          else if (level === 'dayList') dayListBox.focus();
        },
        { width: '50%', dismissOnBlur: true },
      );
    }
    dayListBox.key('.', openActionMenu);

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
    selected.clear();
    gridBox.hide();
    dayListBox.hide();
    calDetailBox.hide();
  }

  return { activate, deactivate };
}
