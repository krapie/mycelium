'use strict';
const vscode = require('vscode');
const path = require('node:path');
const { existsSync } = require('node:fs');
const { randomBytes } = require('node:crypto');
const { renderPanel } = require('./panel-html.js');

/**
 * The session detail tab. One panel, reused: clicking another session swaps
 * its content, the way a preview tab does. Buttons post a message; each one
 * runs the same registered command a tree context-menu item does, so there is
 * a single implementation of resume/handoff/move/tag.
 */
class SessionPanel {
  constructor(ctx, client, { language }) {
    this.ctx = ctx;
    this.client = client;
    this.language = language;
    this.panel = null;
    this.detail = null;
  }

  async show(id, { reveal = true } = {}) {
    const detail = await this.client.request('detail', { id });
    this.detail = detail;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel('mycelium.session', '', vscode.ViewColumn.Active, { enableScripts: true });
      this.panel.iconPath = vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'icon.svg');
      this.panel.onDidDispose(() => {
        this.panel = null;
        this.detail = null;
      });
      this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m));
    } else if (reveal) {
      this.panel.reveal(undefined, true);
    }
    this.panel.title = (detail.extracted && detail.extracted.title) || detail.id.slice(0, 8);
    this.panel.webview.html = renderPanel(detail, { nonce: randomBytes(16).toString('hex'), language: this.language });
  }

  /** After a move/tag/summarize: redraw if still open; close if the session is gone. */
  async reload() {
    if (!this.panel || !this.detail) return;
    try {
      // reveal:false — a background refresh must not pull this tab forward.
      await this.show(this.detail.id, { reveal: false });
    } catch {
      this.panel.dispose();
    }
  }

  element() {
    const d = this.detail;
    return { type: 'session', row: { id: d.id, title: d.extracted && d.extracted.title, folder: d.folder, source: d.source, kind: d.kind, mergedFrom: d.mergedFrom, splitFrom: d.splitFrom } };
  }

  async onMessage(m) {
    if (!this.detail || !m) return;
    const run = (cmd, ...args) => vscode.commands.executeCommand(cmd, ...args);
    switch (m.action) {
      case 'resume':
      case 'resumeInTerminal':
      case 'handoff':
      case 'move':
      case 'tag':
      case 'copyId':
      case 'autotag':
        return run(`mycelium.${m.action}`, this.element());
      case 'copyPrompt':
        return run('mycelium.copyHandoffPrompt', this.element());
      case 'open':
        if (typeof m.id === 'string') await this.show(m.id).catch((e) => vscode.window.showErrorMessage(`Mycelium: ${e.message}`));
        return;
      case 'folder':
        return run('mycelium.revealFolder', m.folder);
      case 'transcript':
        return run('mycelium.viewTranscript', this.detail.id);
      case 'file':
        return this.openFile(m.path);
    }
  }

  // The path comes out of a transcript, so it is only opened when it resolves
  // to a real file inside the directory the session ran in.
  async openFile(p) {
    const root = this.detail.projectDir || this.detail.cwd;
    if (!root || typeof p !== 'string') return;
    const abs = path.resolve(root, p);
    const rel = path.relative(root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel) || !existsSync(abs)) return;
    await vscode.window.showTextDocument(vscode.Uri.file(abs));
  }
}

module.exports = { SessionPanel };
