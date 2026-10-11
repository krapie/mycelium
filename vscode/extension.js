'use strict';
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Client } = require('./src/client.js');
const { FoldersTree } = require('./src/tree.js');
const { workspaceView, recentView, workspaceGroups } = require('./src/views.js');
const { dndController } = require('./src/dnd.js');
const { SessionPanel } = require('./src/panel.js');
const { ActionsView } = require('./src/actions.js');
const { register, GUIDE } = require('./src/commands.js');
const { launchDir, claim } = require('./src/launch.js');
const { openTerminal } = require('./src/session-terminal.js');
const { workspaceDirs } = require('./src/views.js');
const { strings } = require('./src/i18n.js');
const { state, markConnected, handleError } = require('./src/state.js');

const MIN_PROTOCOL = 1;

function makeClient() {
  const cfg = vscode.workspace.getConfiguration('mycelium');
  const home = cfg.get('home');
  return new Client({ command: cfg.get('path') || 'mycelium', env: home ? { MYCELIUM_HOME: home } : {} });
}

async function activate(ctx) {
  const language = vscode.env.language;
  const t = strings(language);

  // One indirection so a settings change swaps the CLI path/home without
  // re-registering anything: every consumer calls through `proxy`.
  let client = makeClient();
  const proxy = { request: (m, p, o) => client.request(m, p, o) };

  let foldersView;
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'mycelium.menu';
  status.text = '$(type-hierarchy) Mycelium';
  status.show();

  let storeLabel = '';
  const updateStatus = async () => {
    try {
      const [f, groups, pending] = await Promise.all([proxy.request('folders'), workspaceGroups(proxy), proxy.request('knowledgePending')]);
      markConnected();
      const here = groups.reduce((n, g) => n + g.rows.length, 0);
      status.text = `$(type-hierarchy) ${here} ${t.here} · ${f.inbox} ${t.newCount}${pending.length ? ` · $(book) ${pending.length}` : ''}`;
      actions.setStats({ inbox: f.inbox, pending: pending.length });
      status.tooltip = [`Mycelium${storeLabel ? ` — ${storeLabel}` : ''}`, pending.length ? `${pending.length} knowledge update(s) to review` : ''].filter(Boolean).join('\n');
    } catch (err) {
      status.text = '$(warning) Mycelium';
      handleError(err);
    }
  };

  const folders = new FoldersTree(proxy, {
    language,
    onLoaded: (f) => {
      if (foldersView) foldersView.badge = f.inbox ? { value: f.inbox, tooltip: `${f.inbox} not filed into a folder yet` } : undefined;
    },
  });
  const actions = new ActionsView({ language });
  const workspace = workspaceView(proxy, language);
  const recent = recentView(proxy, language);
  const panel = new SessionPanel(ctx, proxy, { language });

  const refresh = async () => {
    folders.refresh();
    workspace.refresh();
    recent.refresh();
    await Promise.all([panel.reload(), updateStatus()]);
  };

  const actionsView = vscode.window.createTreeView('mycelium.actions', { treeDataProvider: actions });
  foldersView = vscode.window.createTreeView('mycelium.folders', {
    treeDataProvider: folders,
    canSelectMany: true,
    showCollapseAll: true,
    dragAndDropController: dndController(proxy, { accept: true, onMoved: refresh }),
  });
  ctx.subscriptions.push(
    foldersView,
    actionsView,
    vscode.window.createTreeView('mycelium.workspace', { treeDataProvider: workspace, canSelectMany: true, dragAndDropController: dndController(proxy, { accept: false, onMoved: refresh }) }),
    vscode.window.createTreeView('mycelium.recent', { treeDataProvider: recent, canSelectMany: true, dragAndDropController: dndController(proxy, { accept: false, onMoved: refresh }) }),
    status,
  );

  let watcher;
  let debounce;
  const watch = async () => {
    watcher?.dispose();
    try {
      const hello = await proxy.request('hello');
      state.home = hello.home;
      // Which store this window is showing, in plain sight — a sample store and
      // a real one look alike, and mixing them up is a real mistake to make.
      const shown = hello.home.startsWith(os.homedir()) ? `~${hello.home.slice(os.homedir().length)}` : hello.home;
      actionsView.description = shown;
      storeLabel = shown;
      updateStatus();
      markConnected();
      if (hello.protocol < MIN_PROTOCOL) {
        vscode.window.showWarningMessage(`Mycelium ${hello.version} is too old for this extension — run: npm i -g @kevinprk/mycelium`);
      }
      // The TUI, the daemon and sync all write raw/ behind the extension's back.
      watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.join(hello.home, 'raw')), '*.json'));
      const poke = () => {
        clearTimeout(debounce);
        debounce = setTimeout(refresh, 600);
      };
      watcher.onDidCreate(poke);
      watcher.onDidChange(poke);
      watcher.onDidDelete(poke);
    } catch (err) {
      handleError(err); // a missing CLI becomes the install welcome view
    }
  };

  ctx.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('mycelium')) return;
      client.dispose();
      client = makeClient();
      watch().then(refresh);
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(refresh),
    { dispose: () => { clearTimeout(debounce); watcher?.dispose(); client.dispose(); } },
  );

  register(ctx, { client: proxy, panel, refresh, foldersView, language });

  // Sessions another window asked this one to start (see launch.js): any that
  // belong to a folder open here. Checked now — a window opened just for this
  // arrives after the request was written — and again as new requests land.
  const takeLaunches = () => {
    for (const launch of claim(launchDir(), workspaceDirs())) openTerminal(launch);
  };
  fs.mkdirSync(launchDir(), { recursive: true });
  const launches = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(launchDir()), '*.json'));
  launches.onDidCreate(takeLaunches);
  ctx.subscriptions.push(launches, vscode.workspace.onDidChangeWorkspaceFolders(takeLaunches));
  takeLaunches();

  await watch();
  updateStatus();

  // First run only: the guide is how people learn the capture → organize →
  // learn → reuse loop, so don't make them go looking for it.
  if (!ctx.globalState.get('mycelium.guideShown')) {
    await ctx.globalState.update('mycelium.guideShown', true);
    vscode.commands.executeCommand('workbench.action.openWalkthrough', GUIDE, false);
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
