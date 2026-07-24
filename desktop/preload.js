import { contextBridge, ipcRenderer } from 'electron';

// Narrow, explicit API surface — the renderer never gets direct Node/IPC
// access (contextIsolation stays on, nodeIntegration stays off).
contextBridge.exposeInMainWorld('mycelium', {
  data: {
    folders: () => ipcRenderer.invoke('data:folders'),
    sessions: (opts) => ipcRenderer.invoke('data:sessions', opts),
    detail: (id) => ipcRenderer.invoke('data:detail', id),
    agents: () => ipcRenderer.invoke('data:agents'),
  },
  organize: {
    move: (id, folder) => ipcRenderer.invoke('organize:move', id, folder),
    tag: (id, add, remove) => ipcRenderer.invoke('organize:tag', id, add, remove),
    delete: (id) => ipcRenderer.invoke('organize:delete', id),
    setTitle: (id, title) => ipcRenderer.invoke('organize:setTitle', id, title),
  },
  learn: {
    autoTag: (id) => ipcRenderer.invoke('learn:autoTag', id),
    tagAll: () => ipcRenderer.invoke('learn:tagAll'),
  },
  smart: {
    pending: () => ipcRenderer.invoke('smart:pending'),
    suggest: () => ipcRenderer.invoke('smart:suggest'),
    apply: (placements) => ipcRenderer.invoke('smart:apply', placements),
  },
  scan: {
    run: () => ipcRenderer.invoke('scan:run'),
  },
  pty: {
    start: (opts) => ipcRenderer.invoke('pty:start', opts),
    input: (ptyId, chunk) => ipcRenderer.send('pty:input', ptyId, chunk),
    resize: (ptyId, cols, rows) => ipcRenderer.send('pty:resize', ptyId, cols, rows),
    kill: (ptyId) => ipcRenderer.send('pty:kill', ptyId),
    onData: (cb) => ipcRenderer.on('pty:data', (_e, ptyId, chunk) => cb(ptyId, chunk)),
    onExit: (cb) => ipcRenderer.on('pty:exit', (_e, ptyId, code) => cb(ptyId, code)),
  },
});
