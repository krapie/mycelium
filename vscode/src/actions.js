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
  ['scan', 'sync', 'mycelium.scan'],
  ['summarize', 'sparkle', 'mycelium.autotagAll'],
  ['organize', 'wand', 'mycelium.organize'],
  ['knowledge', 'book', 'mycelium.extractKnowledge'],
  ['search', 'search', 'mycelium.search'],
  ['newAgent', 'add', 'mycelium.newAgent'],
  ['review', 'bell-dot', 'mycelium.reviewKnowledge'],
  ['guide', 'question', 'mycelium.openGuide'],
];

/**
 * A always-visible list of what you can do, in the order you'd do it. The
 * same commands also sit on the other views' title bars, but those icons only
 * appear when you hover a view header, so nobody finds them; this is the
 * place a new user looks first.
 */
class ActionsView {
  constructor({ language }) {
    this.t = strings(language);
    this.stats = { inbox: 0, pending: 0 };
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
  }

  /** Counts that make an action's urgency visible: how much is unfiled / waiting. */
  setStats(stats) {
    this.stats = stats;
    this._emitter.fire();
  }

  getTreeItem(id) {
    const [, icon, command] = ACTIONS.find(([a]) => a === id);
    const a = this.t.actions[id];
    const item = new vscode.TreeItem(a.label, vscode.TreeItemCollapsibleState.None);
    item.id = `a:${id}`;
    let extra = '';
    if (id === 'organize' && this.stats.inbox) extra = ` · ${this.t.unfiledN(this.stats.inbox)}`;
    if (id === 'review') extra = ` · ${this.t.waitingN(this.stats.pending)}`;
    item.description = a.stage + extra;
    item.iconPath = new vscode.ThemeIcon(icon);
    item.tooltip = a.tip;
    item.command = { command, title: a.label };
    return item;
  }

  getChildren(el) {
    if (el) return [];
    // "Review" only means something while there is something to review.
    return ACTIONS.map(([id]) => id).filter((id) => id !== 'review' || this.stats.pending > 0);
  }
}

module.exports = { ActionsView };
