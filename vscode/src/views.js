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
const path = require('node:path');
const { sessionItem, groupItem } = require('./items.js');
const { groupByRecency } = require('./format.js');
const { strings } = require('./i18n.js');
const { markConnected, handleError } = require('./state.js');

const workspaceDirs = () => (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);

/** Sessions that ran in (or below) an open workspace folder, grouped per folder when there are several. */
async function workspaceGroups(client) {
  const dirs = workspaceDirs();
  const out = [];
  for (const dir of dirs) {
    const rows = await client.request('sessions', { dir });
    if (rows.length) out.push({ key: dir, label: dirs.length > 1 ? path.basename(dir) : null, rows });
  }
  return out;
}

async function recentGroups(client, language) {
  const t = strings(language);
  const rows = await client.request('sessions', { limit: 200 });
  return groupByRecency(rows).map((g) => ({ key: g.key, label: t[g.key], rows: g.rows }));
}

/** Shared by This Workspace and Recent: a list of sessions, optionally under group headings. */
class ListView {
  constructor(client, { load, language, showFolder }) {
    this.client = client;
    this.load = load;
    this.language = language;
    this.showFolder = showFolder;
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
  }

  refresh() {
    this._emitter.fire();
  }

  getTreeItem(el) {
    return el.type === 'group' ? groupItem(el) : sessionItem(el.row, { language: this.language, showFolder: this.showFolder });
  }

  async getChildren(el) {
    try {
      if (el) return el.type === 'group' ? el.rows.map((row) => ({ type: 'session', row })) : [];
      const groups = await this.load(this.client);
      markConnected();
      if (!groups.length) return [];
      // A single unlabeled group is just the list; no heading to hang it under.
      if (groups.length === 1 && !groups[0].label) return groups[0].rows.map((row) => ({ type: 'session', row }));
      return groups.map((g) => ({ type: 'group', key: g.key, label: g.label, rows: g.rows }));
    } catch (err) {
      handleError(err);
      return [];
    }
  }
}

const workspaceView = (client, language) => new ListView(client, { load: workspaceGroups, language, showFolder: true });
const recentView = (client, language) => new ListView(client, { load: (c) => recentGroups(c, language), language, showFolder: true });

module.exports = { workspaceView, recentView, workspaceGroups, workspaceDirs };
