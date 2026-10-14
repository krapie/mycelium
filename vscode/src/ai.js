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
const { existsSync } = require('node:fs');
const { state } = require('./state.js');

const KNOWLEDGE_SCHEME = 'mycelium-knowledge';
const AUTOTAG_BATCH = 25;

// Virtual documents for the knowledge diff, keyed by URI string.
const docs = new Map();
const docUri = (kind, folder) => vscode.Uri.parse(`${KNOWLEDGE_SCHEME}:/${kind}/${folder}/KNOWLEDGE.md`);

const rowsOf = (el, sel) => (sel && sel.length ? sel : [el]).filter((e) => e && e.type === 'session').map((e) => e.row);

/**
 * The commands that call an LLM (through the user's own claude/codex CLI):
 * summarize, smart organize, extract folder knowledge. Each runs as a
 * cancellable notification; the bridge reports progress, and cancel kills the
 * in-flight CLI children.
 */
function registerAi(ctx, { client, askCli, refresh, run, pickFolder }) {
  ctx.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(KNOWLEDGE_SCHEME, {
      provideTextDocumentContent: (uri) => docs.get(uri.toString()) ?? '',
    }),
  );

  const llm = (title, method, params) =>
    vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: true }, async (progress, token) => {
      token.onCancellationRequested(() => client.request('cancel').catch(() => {}));
      let shown = 0;
      // askCli: the CLI looks for claude/codex on the PATH it was started with;
      // when that lacks them, it is asked again with the login shell's.
      const result = await askCli(method, params, {
        onProgress: (i) => {
          const message = i.total ? `${i.done ?? 0}/${i.total}` : i.done ? String(i.done) : i.message === 'classifying' ? 'classifying…' : i.message === 'summarizing' ? `summarizing ${i.total ?? ''}…` : '';
          // withProgress wants increments, not totals
          const inc = i.total && i.done ? ((i.done - shown) / i.total) * 100 : undefined;
          if (i.done) shown = i.done;
          progress.report({ message, increment: inc });
        },
      });
      if (token.isCancellationRequested) throw Object.assign(new Error('cancelled'), { cancelled: true });
      return result;
    });

  // A cancel is the user's own choice, not an error worth a red toast.
  const runLlm = (id, fn) =>
    run(id, async (...args) => {
      try {
        await fn(...args);
      } catch (err) {
        if (err.cancelled) return vscode.window.setStatusBarMessage('Mycelium: cancelled', 3000);
        throw err;
      }
    });

  runLlm('mycelium.autotag', async (el, sel) => {
    const ids = rowsOf(el, sel).map((r) => r.id);
    if (!ids.length) return;
    const r = await llm('Mycelium: summarizing…', 'autotag', { ids });
    await refresh();
    vscode.window.showInformationMessage(r.failed ? `Mycelium: summarized ${r.tagged}, ${r.failed} failed` : `Mycelium: summarized ${r.tagged} session${r.tagged === 1 ? '' : 's'}`);
  });

  runLlm('mycelium.autotagAll', async () => {
    const r = await llm('Mycelium: summarizing sessions…', 'autotag', { limit: AUTOTAG_BATCH });
    await refresh();
    const more = r.tagged >= AUTOTAG_BATCH ? ' — run again for more' : '';
    vscode.window.showInformationMessage(r.stoppedEarly ? `Mycelium: stopped after ${r.tagged} (the LLM kept failing — usage limit?)` : `Mycelium: summarized ${r.tagged}${more}`);
  });

  runLlm('mycelium.organize', async (el) => {
    const folder = el && el.type === 'folder' ? el.path : undefined;
    const list = await llm('Mycelium: organizing…', 'organizeSuggest', { folder });
    await refresh();
    if (!list.length) return vscode.window.showInformationMessage('Mycelium: nothing to organize — every session is filed, or none matched a folder confidently');
    const picks = await vscode.window.showQuickPick(
      list.map((p) => ({
        label: p.title || p.preview || p.id.slice(0, 8),
        description: `${p.from || 'New'} → ${p.folder}${p.newFolder ? ' (new folder)' : ''}`,
        detail: p.reason || undefined,
        picked: true,
        p,
      })),
      { canPickMany: true, matchOnDetail: true, title: 'Smart organize', placeHolder: 'Uncheck what you don’t want filed, then press Enter' },
    );
    // Esc leaves the suggestions queued, so running this again shows them instantly.
    if (!picks) return;
    const accept = picks.map((x) => ({ id: x.p.id, folder: x.p.folder }));
    const reject = list.filter((p) => !picks.some((x) => x.p.id === p.id)).map((p) => p.id);
    const { applied } = await client.request('organizeApply', { accept, reject });
    await refresh();
    vscode.window.showInformationMessage(`Mycelium: filed ${applied} session${applied === 1 ? '' : 's'}`);
  });

  // Diff current vs proposed knowledge and ask. Resolves 'save' | 'discard' | 'all' | undefined (left for later).
  // `allLabel` adds a third button that accepts this one and everything still queued.
  const reviewDiff = async (folder, current, proposed, { saveLabel = 'Save', discardLabel = 'Discard', allLabel } = {}) => {
    const cur = docUri('current', folder);
    const prop = docUri('proposed', folder);
    docs.set(cur.toString(), current || '');
    docs.set(prop.toString(), proposed);
    await vscode.commands.executeCommand('vscode.diff', cur, prop, `KNOWLEDGE.md — ${folder}${current ? '' : ' (new)'}`);
    const buttons = allLabel ? [saveLabel, allLabel, discardLabel] : [saveLabel, discardLabel];
    const pick = await vscode.window.showInformationMessage(`Update the knowledge for “${folder}”? It is injected into AGENTS.md for future sessions.`, ...buttons);
    return pick === saveLabel ? 'save' : pick === discardLabel ? 'discard' : pick === allLabel && allLabel ? 'all' : undefined;
  };

  runLlm('mycelium.extractKnowledge', async (el) => {
    const folder = el && el.type === 'folder' ? el.path : await pickFolder();
    if (!folder) return;
    const built = await llm(`Mycelium: extracting knowledge for ${folder}…`, 'knowledgeBuild', { folder });
    const choice = await reviewDiff(folder, built.current, built.text);
    if (choice === 'save') {
      await client.request('knowledgeSave', { folder, text: built.text });
      await refresh();
      vscode.window.showInformationMessage(`Mycelium: saved knowledge for ${folder}`);
    }
  });

  // Proposals the daemon staged overnight, one at a time.
  run('mycelium.reviewKnowledge', async () => {
    const pending = await client.request('knowledgePending');
    if (!pending.length) return vscode.window.showInformationMessage('Mycelium: no knowledge updates waiting for review');
    let promoted = 0;
    let acceptAll = false;
    // With several waiting, offer to take them all without opening each diff.
    if (pending.length > 1) {
      const first = await vscode.window.showInformationMessage(`Mycelium: ${pending.length} knowledge updates are waiting.`, 'Accept all', 'Review one by one');
      if (!first) return;
      acceptAll = first === 'Accept all';
    }
    for (const [i, p] of pending.entries()) {
      const choice = acceptAll
        ? 'save'
        : await reviewDiff(p.folder, p.current, p.text, { saveLabel: 'Accept', discardLabel: 'Reject', allLabel: i < pending.length - 1 ? 'Accept all remaining' : undefined });
      if (choice === 'all') acceptAll = true;
      if (choice === 'save' || choice === 'all') {
        await client.request('knowledgePromote', { folder: p.folder });
        promoted++;
      } else if (choice === 'discard') await client.request('knowledgeDismiss', { folder: p.folder });
      else break; // dismissed the prompt: stop here, the rest stay queued
    }
    await refresh();
    if (promoted) vscode.window.showInformationMessage(`Mycelium: accepted ${promoted} knowledge update${promoted === 1 ? '' : 's'}`);
  });

  run('mycelium.openKnowledge', async (el) => {
    const folder = el && el.type === 'folder' ? el.path : await pickFolder();
    if (!folder || !state.home) return;
    const file = path.join(state.home, 'tree', ...folder.split('/'), 'KNOWLEDGE.md');
    if (existsSync(file)) return vscode.window.showTextDocument(vscode.Uri.file(file));
    const pick = await vscode.window.showInformationMessage(`“${folder}” has no KNOWLEDGE.md yet.`, 'Extract it');
    if (pick) await vscode.commands.executeCommand('mycelium.extractKnowledge', { type: 'folder', path: folder });
  });
}

module.exports = { registerAi };
