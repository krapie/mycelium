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
const { strings } = require('./i18n.js');

// id -> [codicon, command]. Order is the order of the loop, so the view reads
// top to bottom the way the work goes.
const ACTIONS = [
  ['runAll', 'run-all', 'mycelium.runAll'],
  ['upkeep', 'pulse', 'mycelium.upkeepMenu'],
  ['scan', 'sync', 'mycelium.scan'],
  ['summarize', 'sparkle', 'mycelium.autotagAll'],
  ['organize', 'wand', 'mycelium.organize'],
  ['knowledge', 'book', 'mycelium.extractKnowledge'],
  ['search', 'search', 'mycelium.search'],
  ['calendar', 'calendar', 'mycelium.calendar'],
  ['newAgent', 'add', 'mycelium.newAgent'],
  ['backlog', 'checklist', 'mycelium.backlogAdd'],
  ['review', 'bell-dot', 'mycelium.reviewKnowledge'],
  ['guide', 'question', 'mycelium.openGuide'],
];

// "Review" only means something while there is something to review; while the
// background upkeep is on it scans and summarizes by itself, so those two steps
// are not offered as chores (they stay in the command palette).
function visible(id, stats, calendarOn) {
  if (id === 'review') return stats.pending > 0;
  if (id === 'calendar') return !!calendarOn;
  if (id === 'scan' || id === 'summarize') return !stats.upkeep;
  return true;
}

/**
 * A always-visible list of what you can do, in the order you'd do it. The
 * same commands also sit on the other views' title bars, but those icons only
 * appear when you hover a view header, so nobody finds them; this is the
 * place a new user looks first.
 */
class ActionsView {
  constructor({ language }) {
    this.t = strings(language);
    this.stats = { inbox: 0, pending: 0, suggestions: 0, upkeep: false };
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
  }

  /** Counts that make an action's urgency visible: how much is unfiled / waiting. */
  setStats(stats) {
    this.stats = stats;
    this.upkeepLine = stats.upkeepLine || '';
    this._emitter.fire();
  }

  getTreeItem(id) {
    const [, icon, command] = ACTIONS.find(([a]) => a === id);
    const a = this.t.actions[id];
    const item = new vscode.TreeItem(a.label, vscode.TreeItemCollapsibleState.None);
    item.id = `a:${id}`;
    let extra = '';
    if (id === 'organize') extra = this.stats.suggestions ? ` · ${this.t.suggestedN(this.stats.suggestions)}` : this.stats.inbox ? ` · ${this.t.unfiledN(this.stats.inbox)}` : '';
    if (id === 'upkeep') extra = ` · ${this.stats.upkeep ? this.t.upkeepOn : this.t.upkeepOff}`;
    if (id === 'review') extra = ` · ${this.t.waitingN(this.stats.pending)}`;
    item.description = a.stage + extra;
    item.iconPath = new vscode.ThemeIcon(icon);
    item.tooltip = id === 'upkeep' && this.upkeepLine ? `${a.tip}\n\n${this.upkeepLine}` : a.tip;
    item.command = { command, title: a.label };
    return item;
  }

  getChildren(el) {
    if (el) return [];
    const calendarOn = vscode.workspace.getConfiguration('mycelium').get('experimental.calendar');
    return ACTIONS.map(([id]) => id).filter((id) => visible(id, this.stats, calendarOn));
  }
}

module.exports = { ActionsView, visible };
