'use strict';
const vscode = require('vscode');
const { transcriptMarkdown } = require('./markdown.js');
const { relativeTime, agentKey } = require('./format.js');
const { strings } = require('./i18n.js');
const { openLaunch, panelWanted } = require('./open-session.js');
const { isClaudeSession, forWindow } = require('./claude-code.js');
const { launchDir, relatedTo, enqueue, pending, withdraw } = require('./launch.js');
const { workspaceDirs } = require('./views.js');
const { registerAi } = require('./ai.js');

const TRANSCRIPT_SCHEME = 'mycelium-transcript';
const GUIDE = 'krapie.mycelium-vscode#mycelium.start';

const rowsOf = (el, sel) => (sel && sel.length ? sel : [el]).filter((e) => e && e.type === 'session').map((e) => e.row);

function register(ctx, { client, panel, refresh, foldersView, language, log }) {
  const t = strings(language);

  const run = (id, fn) =>
    ctx.subscriptions.push(
      vscode.commands.registerCommand(id, async (...args) => {
        try {
          await fn(...args);
        } catch (err) {
          const message = (err && err.message) || String(err);
          if (err && err.code === 'ENOENT') {
            const pick = await vscode.window.showErrorMessage(`${message}. Install with: npm i -g @kevinprk/mycelium`, 'Open Settings');
            if (pick) vscode.commands.executeCommand('workbench.action.openSettings', 'mycelium.path');
          } else vscode.window.showErrorMessage(`Mycelium: ${message}`);
        }
      }),
    );

  // Where a session starts. It belongs in the window of the project it ran in
  // (a terminal there, or the Claude Code panel — Claude Code only finds a
  // session through the project its window has open): if that is not what this
  // window has open, ask VS Code for a window on that directory and hand the
  // launch over (launch.js). Without a folder open here, this window itself
  // switches to the project. If nothing in the other window takes the request
  // — the extension isn't installed there, say — it starts here instead of
  // silently doing nothing.
  const startSession = async (launch) => {
    const folders = workspaceDirs();
    const mode = vscode.workspace.getConfiguration('mycelium').get('openSessionIn');
    const hasProject = relatedTo(launch.cwd, folders);
    if (mode === 'thisWindow' || hasProject) return openLaunch(forWindow(launch, { hasProject }), log);

    const file = enqueue(launchDir(), launch);
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(launch.cwd), { forceNewWindow: folders.length > 0 });
    if (!folders.length) return; // this window reloads onto the folder and takes the request itself
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (!pending(file)) return;
    }
    if (!withdraw(file)) return; // taken at the last moment
    await openLaunch(forWindow(launch, { hasProject: false }), log);
    vscode.window.showWarningMessage(`Mycelium: the window for ${launch.cwd} didn't pick this up (is the Mycelium extension installed there?), so it started here instead.`);
  };

  const pickDir = async (folder) => {
    const dirs = new Set(workspaceDirs());
    if (folder) for (const d of await client.request('dirsForFolder', { folder })) dirs.add(d);
    const list = [...dirs];
    if (list.length <= 1) return list[0];
    return vscode.window.showQuickPick(list, { placeHolder: 'Working directory' });
  };

  const pickAgent = async (placeHolder, extra = []) => {
    // `all` (a CLI from 0.5.1) also returns agents that aren't on PATH; Claude
    // is still usable then, through Claude Code's panel. An older CLI ignores
    // `all` and sends only what is on PATH, as before.
    const all = await client.request('agents', { all: true });
    const agents = all.filter((a) => a.onPath !== false || (a.key === 'claude' && panelWanted('claude')));
    if (!agents.length && !extra.length) {
      vscode.window.showWarningMessage('Mycelium: no agent CLI found on PATH (install claude, codex, …)');
      return undefined;
    }
    return vscode.window.showQuickPick([...agents.map((a) => ({ label: a.label, key: a.key })), ...extra], { placeHolder });
  };

  const pickFolder = async ({ allowRoot = false } = {}) => {
    const { list } = await client.request('folders');
    const items = [...(allowRoot ? [{ label: `$(inbox) ${t.unfiled}`, value: '' }] : []), ...list.map((p) => ({ label: p, value: p })), { label: '$(add) New folder…', value: null }];
    const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Folder' });
    if (!pick) return undefined;
    if (pick.value !== null) return pick.value;
    const name = await vscode.window.showInputBox({ prompt: 'New folder path (e.g. Projects/api)' });
    if (!name) return undefined;
    await client.request('mkdir', { folder: name });
    return name;
  };

  // Read-only virtual document: the raw conversation, shown as Markdown.
  ctx.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(TRANSCRIPT_SCHEME, {
      async provideTextDocumentContent(uri) {
        const id = uri.path.replace(/^\//, '').replace(/\.md$/, '');
        return transcriptMarkdown(await client.request('detail', { id, turns: true }));
      },
    }),
  );

  run('mycelium.refresh', refresh);
  run('mycelium.showLog', () => log.show(true));

  run('mycelium.scan', () =>
    vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Mycelium: scanning…' }, async () => {
      const s = await client.request('scan');
      await refresh();
      const n = s.imported ?? 0;
      vscode.window.showInformationMessage(n ? `Mycelium: captured ${n} new session${n === 1 ? '' : 's'}` : 'Mycelium: up to date — no new sessions');
    }),
  );

  run('mycelium.open', async (el) => {
    if (el && el.row) await panel.show(el.row.id);
  });

  run('mycelium.viewTranscript', (id) =>
    vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.parse(`${TRANSCRIPT_SCHEME}:/${id}.md`)),
  );

  run('mycelium.search', async () => {
    const qp = vscode.window.createQuickPick();
    qp.placeholder = 'Search sessions (full text)';
    qp.matchOnDescription = qp.matchOnDetail = true;
    let timer;
    let seq = 0;
    const buttons = [
      { iconPath: new vscode.ThemeIcon('play'), tooltip: t.resume },
      { iconPath: new vscode.ThemeIcon('arrow-swap'), tooltip: t.handoff },
    ];
    const load = async (q) => {
      const mine = ++seq;
      qp.busy = true;
      try {
        const rows = await client.request('sessions', { query: q.trim() || undefined, limit: 100 });
        if (mine !== seq) return; // a newer keystroke already asked
        qp.items = rows.map((r) => ({
          label: r.title || r.preview || r.id.slice(0, 8),
          description: [relativeTime(r.startedAt, Date.now(), language), r.folder || t.unfiled].filter(Boolean).join(' · '),
          detail: r.snippet || r.summary || undefined,
          iconPath: new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor(`mycelium.agent.${agentKey(r)}`)),
          buttons,
          row: r,
        }));
      } finally {
        if (mine === seq) qp.busy = false;
      }
    };
    qp.onDidChangeValue((q) => {
      clearTimeout(timer);
      timer = setTimeout(() => load(q).catch(() => {}), 200);
    });
    qp.onDidAccept(() => {
      const [sel] = qp.selectedItems;
      qp.hide();
      if (sel) panel.show(sel.row.id).catch((e) => vscode.window.showErrorMessage(`Mycelium: ${e.message}`));
    });
    qp.onDidTriggerItemButton((e) => {
      qp.hide();
      vscode.commands.executeCommand(e.button === buttons[0] ? 'mycelium.resume' : 'mycelium.handoff', { type: 'session', row: e.item.row });
    });
    qp.onDidHide(() => qp.dispose());
    qp.show();
    load('').catch(() => {}); // most recent first, before anything is typed
  });

  // A Claude Code session opens in the Claude Code panel when that extension
  // is there (and `mycelium.claudeCode.openIn` / its own `useTerminal` allow
  // it); every other agent, and `terminalOnly`, uses a terminal.
  const resumeSession = async (el, { terminalOnly = false } = {}) => {
    const [row] = rowsOf(el);
    if (!row) return;
    try {
      const panel = !terminalOnly && isClaudeSession(row) ? { sessionId: row.id } : undefined; // the window that runs it decides if the panel is available
      // The panel needs no `claude` on PATH (Claude Code ships its own), so don't refuse for that
      const cmd = await client.request('resumeCommand', { id: row.id, allowMissingBin: !!panel });
      await startSession({ name: row.title || row.id.slice(0, 8), cwd: cmd.cwd, bin: cmd.bin, args: cmd.args, key: agentKey(row), panel, binMissing: cmd.binMissing });
    } catch (err) {
      if (!/use handoff/.test(err.message)) throw err;
      const pick = await vscode.window.showWarningMessage(err.message, 'Hand off');
      if (pick) await vscode.commands.executeCommand('mycelium.handoff', el);
    }
  };
  run('mycelium.resume', (el) => resumeSession(el));
  run('mycelium.resumeInTerminal', (el) => resumeSession(el, { terminalOnly: true }));

  run('mycelium.handoff', async (el) => {
    const [row] = rowsOf(el);
    if (!row) return;
    const { prompt } = await client.request('handoff', { id: row.id });
    const agent = await pickAgent('Continue with which agent?', [{ label: '$(clippy) Copy prompt only', key: null }]);
    if (!agent) return;
    if (agent.key === null) {
      await vscode.env.clipboard.writeText(prompt);
      return vscode.window.setStatusBarMessage('Mycelium: handoff prompt copied', 3000);
    }
    const d = await client.request('detail', { id: row.id });
    const dir = d.projectDir || d.cwd || (await pickDir(row.folder));
    if (!dir) return;
    // Into Claude Code's panel the prompt is put in the input box, ready to send
    const panel = agent.key === 'claude' ? { prompt } : undefined;
    const cmd = await client.request('newCommand', { agentKey: agent.key, dir, seed: prompt, allowMissingBin: !!panel });
    await startSession({ name: `${agent.label} ← ${row.title || row.id.slice(0, 8)}`, cwd: cmd.cwd, bin: cmd.bin, args: cmd.args, key: agent.key, panel, binMissing: cmd.binMissing });
  });

  run('mycelium.copyHandoffPrompt', async (el) => {
    const [row] = rowsOf(el);
    if (!row) return;
    const { prompt } = await client.request('handoff', { id: row.id });
    await vscode.env.clipboard.writeText(prompt);
    vscode.window.setStatusBarMessage('Mycelium: handoff prompt copied', 3000);
  });

  run('mycelium.newAgent', async (el) => {
    const folder = el && el.type === 'folder' ? el.path : undefined;
    const agent = await pickAgent('Start which agent?');
    if (!agent) return;
    const dir = await pickDir(folder);
    if (!dir) return vscode.window.showWarningMessage('Mycelium: open a folder first, so there is somewhere to start the agent');
    if (folder) {
      const { context } = await client.request('context', { folder });
      if (context) {
        const yes = await vscode.window.showQuickPick(['Yes', 'No'], { placeHolder: `Inject “${folder}” knowledge into AGENTS.md first?` });
        if (!yes) return;
        if (yes === 'Yes') await client.request('inject', { dir, folder });
      }
    }
    const panel = agent.key === 'claude' ? {} : undefined; // {} = a new conversation
    const cmd = await client.request('newCommand', { agentKey: agent.key, dir, allowMissingBin: !!panel });
    await startSession({ name: agent.label, cwd: cmd.cwd, bin: cmd.bin, args: cmd.args, key: agent.key, panel, binMissing: cmd.binMissing });
  });

  run('mycelium.injectAgentsMd', async (el) => {
    const folder = el && el.type === 'folder' ? el.path : await pickFolder();
    if (!folder) return;
    const dir = await pickDir();
    if (!dir) return vscode.window.showWarningMessage('Mycelium: open a workspace folder first');
    const res = await client.request('inject', { dir, folder });
    vscode.window.showInformationMessage(`Mycelium: updated ${res.path}`);
  });

  run('mycelium.move', async (el, sel) => {
    const rows = rowsOf(el, sel);
    if (!rows.length) return;
    const folder = await pickFolder({ allowRoot: true });
    if (folder === undefined) return;
    await client.request('move', { ids: rows.map((r) => r.id), folder });
    await refresh();
  });

  run('mycelium.tag', async (el, sel) => {
    const rows = rowsOf(el, sel);
    if (!rows.length) return;
    const input = await vscode.window.showInputBox({ prompt: 'Tags to add; prefix with - to remove (e.g. bug, -wip)' });
    if (!input) return;
    const words = input.split(/[\s,]+/).filter(Boolean).map((w) => w.replace(/^#/, ''));
    await client.request('tag', {
      ids: rows.map((r) => r.id),
      add: words.filter((w) => !w.startsWith('-')),
      remove: words.filter((w) => w.startsWith('-')).map((w) => w.slice(1)),
    });
    await refresh();
  });

  run('mycelium.mkdir', async (el) => {
    const base = el && el.type === 'folder' ? `${el.path}/` : '';
    const name = await vscode.window.showInputBox({ prompt: 'Folder name', value: base, valueSelection: [base.length, base.length] });
    if (!name) return;
    await client.request('mkdir', { folder: name });
    await refresh();
  });

  run('mycelium.copyId', async (el, sel) => {
    const rows = rowsOf(el, sel);
    if (rows.length) await vscode.env.clipboard.writeText(rows.map((r) => r.id).join('\n'));
  });

  run('mycelium.revealFolder', async (folder) => {
    try {
      await foldersView.reveal({ type: 'folder', path: folder }, { select: true, focus: true, expand: true });
    } catch {
      await vscode.commands.executeCommand('mycelium.folders.focus');
    }
  });

  run('mycelium.openGuide', () => vscode.commands.executeCommand('workbench.action.openWalkthrough', GUIDE, false));

  run('mycelium.menu', async () => {
    const items = [
      { label: `$(sync) ${t.menuScan}`, cmd: 'mycelium.scan' },
      { label: `$(sparkle) ${t.menuOrganize}`, cmd: 'mycelium.organize' },
      { label: `$(search) ${t.menuSearch}`, cmd: 'mycelium.search' },
      { label: `$(add) ${t.menuNewAgent}`, cmd: 'mycelium.newAgent' },
      { label: `$(book) ${t.menuGuide}`, cmd: 'mycelium.openGuide' },
      { label: `$(list-tree) ${t.menuOpen}`, cmd: 'workbench.view.extension.mycelium' },
    ];
    const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Mycelium' });
    if (pick) await vscode.commands.executeCommand(pick.cmd);
  });

  registerAi(ctx, { client, refresh, run, pickFolder });
}

module.exports = { register, GUIDE };
