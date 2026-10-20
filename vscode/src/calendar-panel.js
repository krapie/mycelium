/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

'use strict';
const vscode = require('vscode');
const { randomBytes } = require('node:crypto');
const { renderCalendar } = require('./calendar-html.js');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const pad2 = (n) => String(n).padStart(2, '0');
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const daysIn = (y, m) => new Date(y, m, 0).getDate();

/**
 * The Calendar tab (experimental): a month grid of session counts and the
 * chosen day's sessions. One panel, redrawn on every change, the way
 * SessionPanel is. Open/Resume/Hand off run the same registered commands the
 * tree uses; this class only decides which month and day are showing.
 */
class CalendarPanel {
  constructor(ctx, client, { language, sessionPanel }) {
    this.ctx = ctx;
    this.client = client;
    this.language = language;
    this.sessionPanel = sessionPanel;
    this.panel = null;
    this.rows = new Map();
    this.seq = 0;
    const today = localToday();
    this.setDate(today);
  }

  setDate(date) {
    const [y, m] = date.split('-').map(Number);
    this.year = y;
    this.month = m;
    this.selected = date;
  }

  async show() {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel('mycelium.calendar', 'Mycelium Calendar', vscode.ViewColumn.Active, { enableScripts: true });
      this.panel.iconPath = vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'icon.svg');
      this.panel.onDidDispose(() => {
        this.panel = null;
      });
      this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m).catch((e) => vscode.window.showErrorMessage(`Mycelium: ${e.message}`)));
    } else {
      this.panel.reveal(undefined, true);
    }
    await this.render();
  }

  /** After a scan, move, delete…: redraw if open (the counts may have changed). */
  async reload() {
    if (this.panel) await this.render().catch(() => {});
  }

  async render({ kbd = false } = {}) {
    if (!this.panel) return;
    const mine = ++this.seq;
    const [cal, rows] = await Promise.all([
      this.client.request('calendar', { year: this.year, month: this.month }),
      this.selected ? this.client.request('sessions', { date: this.selected }) : [],
    ]);
    if (mine !== this.seq || !this.panel) return; // a newer click already asked
    this.rows = new Map(rows.map((r) => [r.id, r]));
    this.panel.webview.html = renderCalendar({
      year: this.year, month: this.month, counts: cal.counts, selected: this.selected, rows, today: localToday(),
      nonce: randomBytes(16).toString('hex'), language: this.language, kbd,
    });
  }

  async onMessage(m) {
    if (!m) return;
    switch (m.action) {
      case 'day':
        if (typeof m.date !== 'string' || !DATE.test(m.date)) return;
        this.setDate(m.date);
        return this.render({ kbd: !!m.kbd });
      case 'month': {
        const delta = Number(m.delta) === -1 ? -1 : 1;
        const d = new Date(this.year, this.month - 1 + delta, 1);
        this.year = d.getFullYear();
        this.month = d.getMonth() + 1;
        const day = Math.min(Number(this.selected.slice(8)), daysIn(this.year, this.month));
        this.selected = `${this.year}-${pad2(this.month)}-${pad2(day)}`;
        return this.render();
      }
      case 'today':
        this.setDate(localToday());
        return this.render();
      case 'open':
        if (typeof m.id === 'string') await this.sessionPanel.show(m.id);
        return;
      case 'resume':
      case 'handoff': {
        const row = this.rows.get(m.id); // only ids this page was drawn with
        if (row) await vscode.commands.executeCommand(`mycelium.${m.action}`, { type: 'session', row });
      }
    }
  }
}

module.exports = { CalendarPanel };
