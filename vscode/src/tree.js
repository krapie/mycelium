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
const { folderItem, inboxItem, sessionItem } = require('./items.js');
const { setContext, markConnected, handleError } = require('./state.js');

const parentOf = (p) => p.split('/').slice(0, -1).join('/');

/**
 * Folders view: the real folder hierarchy, then New (unfiled) at the bottom —
 * the TUI's Folders panel. Elements are plain objects; ids are stable so
 * TreeView.reveal() can find a folder again after a refresh.
 */
class FoldersTree {
  constructor(client, { language, onLoaded }) {
    this.client = client;
    this.language = language;
    this.onLoaded = onLoaded;
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
    this.folders = { list: [], counts: {}, inbox: 0, total: 0, knowledge: [] };
  }

  refresh() {
    this._emitter.fire();
  }

  getTreeItem(el) {
    if (el.type === 'inbox') return inboxItem(this.folders.inbox, this.language);
    if (el.type === 'folder') {
      return folderItem(el.path, { count: this.folders.counts[el.path], hasKnowledge: this.folders.knowledge.includes(el.path), language: this.language });
    }
    return sessionItem(el.row, { language: this.language });
  }

  getParent(el) {
    if (el.type === 'folder') {
      const p = parentOf(el.path);
      return p ? { type: 'folder', path: p } : undefined;
    }
    if (el.type === 'session') return el.row.folder ? { type: 'folder', path: el.row.folder } : { type: 'inbox' };
    return undefined;
  }

  async getChildren(el) {
    try {
      if (!el) {
        this.folders = await this.client.request('folders');
        markConnected();
        const empty = this.folders.total === 0 && this.folders.list.length === 0;
        setContext('mycelium.storeEmpty', empty);
        this.onLoaded(this.folders);
        if (empty) return []; // lets the "nothing here yet" welcome view show
        const top = this.folders.list.filter((p) => !p.includes('/')).map((path) => ({ type: 'folder', path }));
        return [...top, { type: 'inbox' }];
      }
      if (el.type === 'inbox') return (await this.client.request('sessions', { folder: null })).map((row) => ({ type: 'session', row }));
      if (el.type === 'folder') {
        const subs = this.folders.list.filter((p) => parentOf(p) === el.path).map((path) => ({ type: 'folder', path }));
        // sessions({folder}) returns the whole subtree; only the ones filed
        // directly here belong under this node, the rest sit under subfolders.
        const rows = (await this.client.request('sessions', { folder: el.path })).filter((r) => r.folder === el.path);
        return [...subs, ...rows.map((row) => ({ type: 'session', row }))];
      }
    } catch (err) {
      handleError(err);
    }
    return [];
  }
}

module.exports = { FoldersTree };
