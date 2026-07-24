const { data, organize, pty } = window.mycelium;

let state = { folder: null, sessions: [] };
const tabs = new Map(); // ptyId -> { title, term, fitAddon, el, paneEl }
let activeTabId = null;

const foldersEl = document.getElementById('folders');
const sessionsEl = document.getElementById('sessions');
const tabbarEl = document.getElementById('tabbar');
const panesEl = document.getElementById('panes');
const newTabBtn = document.getElementById('new-tab-btn');

async function loadFolders() {
  const { list, counts, inbox } = await data.folders();
  foldersEl.innerHTML = '';
  foldersEl.appendChild(folderRow('Root', null, inbox));
  for (const f of list) {
    const depth = f.split('/').length - 1;
    foldersEl.appendChild(folderRow('  '.repeat(depth) + f.split('/').pop(), f, counts.get(f)));
  }
}

function folderRow(label, folder, count) {
  const row = document.createElement('div');
  row.className = 'folder-row' + (state.folder === folder ? ' active' : '');
  row.textContent = `${label} (${count ?? 0})`;
  row.onclick = () => {
    state.folder = folder;
    loadFolders();
    loadSessions();
  };
  return row;
}

async function loadSessions() {
  state.sessions = await data.sessions({ folder: state.folder });
  sessionsEl.innerHTML = '';
  for (const s of state.sessions) {
    const row = document.createElement('div');
    row.className = 'session-row';
    const title = s.title || s.summary || s.preview || '(no content)';
    row.innerHTML = `<span class="title">${escapeHtml(title.slice(0, 60))}</span><span class="meta">#${s.source} #${s.id.slice(0, 8)}</span>`;
    row.onclick = () => openResumeTab(s);
    sessionsEl.appendChild(row);
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ── Tabs / live pty sessions ──
// Clicking a session opens it live immediately — no separate "summary first"
// step, which was the whole point of moving off the TUI for this.
async function openLiveTab(opts, label) {
  const res = await pty.start(opts);
  if (!res.ok) {
    showError(res.error);
    return;
  }
  createTab(res.ptyId, label);
}

// List rows (data.sessions()) deliberately don't carry cwd/projectDir — the
// sqlite index they're read from doesn't have those columns (see
// tui/data.js's mapRow). Resume needs the real raw file for that, same as
// the TUI's doResume does via data.detail(id) before calling resumeSession().
async function openResumeTab(row) {
  const full = await data.detail(row.id);
  openLiveTab(
    { mode: 'resume', session: { id: row.id, source: row.source, cwd: full?.cwd, projectDir: full?.projectDir } },
    row.title || row.id.slice(0, 8),
  );
}

function showError(msg) {
  const el = document.createElement('div');
  el.className = 'error-toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function createTab(ptyId, label) {
  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.innerHTML = `<span class="label">${escapeHtml(label)}</span><span class="close">×</span>`;
  tabEl.querySelector('.label').onclick = () => activateTab(ptyId);
  tabEl.querySelector('.close').onclick = (e) => {
    e.stopPropagation();
    closeTab(ptyId);
  };
  tabbarEl.insertBefore(tabEl, newTabBtn);

  const paneEl = document.createElement('div');
  paneEl.className = 'pane';
  const termEl = document.createElement('div');
  termEl.className = 'term';
  paneEl.appendChild(termEl);
  panesEl.appendChild(paneEl);

  const term = new Terminal({
    theme: {
      background: '#14140f',
      foreground: '#e9e4d6',
      cursor: '#7fe0c4',
    },
    fontSize: 13,
    fontFamily: 'Menlo, monospace',
  });
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(termEl);
  term.onData((chunk) => pty.input(ptyId, chunk));

  tabs.set(ptyId, { title: label, term, fitAddon, el: tabEl, paneEl });
  activateTab(ptyId);
}

function activateTab(ptyId) {
  activeTabId = ptyId;
  for (const [id, t] of tabs) {
    t.el.classList.toggle('active', id === ptyId);
    t.paneEl.classList.toggle('active', id === ptyId);
  }
  const t = tabs.get(ptyId);
  if (t) {
    // fit + focus after the pane is actually visible (display:block), else
    // xterm measures a zero-size container.
    requestAnimationFrame(() => {
      t.fitAddon.fit();
      t.term.focus();
      pty.resize(ptyId, t.term.cols, t.term.rows);
    });
  }
}

function closeTab(ptyId) {
  pty.kill(ptyId);
  const t = tabs.get(ptyId);
  if (!t) return;
  t.el.remove();
  t.paneEl.remove();
  t.term.dispose();
  tabs.delete(ptyId);
  if (activeTabId === ptyId) {
    const next = [...tabs.keys()][0];
    if (next) activateTab(next);
    else activeTabId = null;
  }
}

pty.onData((ptyId, chunk) => {
  tabs.get(ptyId)?.term.write(chunk);
});
pty.onExit((ptyId) => {
  const t = tabs.get(ptyId);
  if (t) t.term.write('\r\n\x1b[2m[session ended]\x1b[0m\r\n');
  loadSessions(); // pick up whatever got captured
});

window.addEventListener('resize', () => {
  const t = tabs.get(activeTabId);
  if (t) {
    t.fitAddon.fit();
    pty.resize(activeTabId, t.term.cols, t.term.rows);
  }
});

// ── New session ──
// Minimal picker for this first slice — a nicer modal is follow-up work
// (see desktop.md phase 3), this proves the pty/tab plumbing end to end.
newTabBtn.onclick = async () => {
  const agents = await data.agents();
  const choice = prompt(`Agent (${agents.map((a) => a.key).join('/')}):`, agents[0]?.key || '');
  const agent = agents.find((a) => a.key === choice);
  if (!agent) return;
  const dir = prompt('Working directory:', '');
  if (!dir) return;
  openLiveTab({ mode: 'new', agentKey: agent.key, dir }, `new (${agent.key})`);
};

loadFolders();
loadSessions();
