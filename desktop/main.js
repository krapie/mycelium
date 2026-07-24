import { app, BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as data from '../src/tui/data.js';
import { move, tag, deleteSession, setContent, suggestPlacements, applyPlacements, queueSuggestions, pendingSuggestions, clearSuggestions } from '../src/organize.js';
import { autoTagSession, tagAll } from '../src/learn.js';
import { scan } from '../src/scanner.js';
import { ensureDaemonRunning } from '../src/daemon.js';
import { AGENTS } from '../src/agents.js';
import { createPtySession, writeToPty, resizePty, killPty } from './pty.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Mycelium',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // pty streaming needs the preload's ipcRenderer.on wiring; no remote content is ever loaded
    },
  });
  mainWindow.loadFile(join(__dirname, 'renderer', 'index.html'));
}

// ── Read-only data (same thin layer the TUI reads from) ──
ipcMain.handle('data:folders', () => data.folders());
ipcMain.handle('data:sessions', (_e, opts) => data.sessions(opts || {}));
ipcMain.handle('data:detail', (_e, id) => data.detail(id));
ipcMain.handle('data:agents', () => Object.entries(AGENTS).map(([key, a]) => ({ key, label: a.label })));

// ── Mutations — identical semantics to the TUI's m/t/x/e keys ──
ipcMain.handle('organize:move', (_e, id, folder) => {
  const res = move(id, folder);
  if (res.ok) data.refreshOne(id);
  return res;
});
ipcMain.handle('organize:tag', (_e, id, add, remove) => {
  const res = tag(id, add, remove);
  if (res.ok) data.refreshOne(id);
  return res;
});
ipcMain.handle('organize:delete', (_e, id) => {
  const res = deleteSession(id);
  if (res.ok) data.refreshOne(id); // raw file gone → refreshOne() correctly removes it from the index
  return res;
});
ipcMain.handle('organize:setTitle', (_e, id, title) => {
  const res = setContent(id, { title });
  if (res.ok) data.refreshOne(id);
  return res;
});

// ── Learn ──
ipcMain.handle('learn:autoTag', async (_e, id) => {
  const res = await autoTagSession(id);
  if (res.ok) data.refreshOne(id);
  return res;
});
ipcMain.handle('learn:tagAll', async () => {
  const res = await tagAll();
  data.refresh();
  return res;
});

// ── Smart organize (same functions the TUI's `o` key and `mycelium organize --smart` use) ──
ipcMain.handle('smart:pending', () => pendingSuggestions());
ipcMain.handle('smart:suggest', async () => suggestPlacements({ batchSize: 25 }));
ipcMain.handle('smart:apply', (_e, placements) => {
  const applied = applyPlacements(placements);
  data.refreshMany(placements.map((p) => p.id));
  clearSuggestions(placements.map((p) => p.id));
  return applied;
});

// ── Capture ──
ipcMain.handle('scan:run', () => {
  const res = scan();
  data.refresh();
  return res;
});

// ── Live sessions (node-pty) — see pty.js ──
ipcMain.handle('pty:start', (e, opts) => createPtySession(mainWindow, opts));
ipcMain.on('pty:input', (_e, ptyId, chunk) => writeToPty(ptyId, chunk));
ipcMain.on('pty:resize', (_e, ptyId, cols, rows) => resizePty(ptyId, cols, rows));
ipcMain.on('pty:kill', (_e, ptyId) => killPty(ptyId));

app.whenReady().then(() => {
  ensureDaemonRunning(); // same background upkeep the TUI gets on launch
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
