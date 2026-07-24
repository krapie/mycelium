import pty from 'node-pty';
import { scan } from '../src/scanner.js';
import * as data from '../src/tui/data.js';
import { AGENTS, binFor, resumeArgsFor, workDirFor, which } from '../src/agents.js';

// ptyId -> { proc, cwd } — one entry per open live session tab.
const sessions = new Map();
let nextId = 1;

/**
 * Spawn a real agent process attached to a pty — either resuming an existing
 * session (reuses agents.js's binFor/resumeArgsFor/workDirFor, the exact
 * functions `mycelium resume` and the TUI's resume flow already use) or
 * launching a new one (reuses AGENTS' bin/newArgs).
 */
export function createPtySession(window, opts) {
  let bin, args, cwd;
  if (opts.mode === 'resume') {
    const session = opts.session;
    bin = binFor(session.source);
    if (!which(bin)) return { ok: false, error: `${bin} not installed` };
    cwd = workDirFor(session);
    if (!cwd) return { ok: false, error: 'no working directory found for this session' };
    args = resumeArgsFor(session.source, session.id);
  } else {
    const agent = AGENTS[opts.agentKey];
    if (!agent) return { ok: false, error: 'unknown agent' };
    if (!which(agent.bin)) return { ok: false, error: `${agent.bin} not installed` };
    bin = agent.bin;
    args = agent.newArgs(opts.seed);
    cwd = opts.dir;
  }

  let proc;
  try {
    proc = pty.spawn(bin, args, {
      name: 'xterm-256color',
      cols: opts.cols || 80,
      rows: opts.rows || 24,
      cwd,
      env: process.env,
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const ptyId = String(nextId++);
  sessions.set(ptyId, { proc, cwd });

  proc.onData((chunk) => {
    if (!window.isDestroyed()) window.webContents.send('pty:data', ptyId, chunk);
  });
  proc.onExit(({ exitCode }) => {
    sessions.delete(ptyId);
    // Re-capture whatever the agent produced — same scan()+targeted-reindex
    // pattern already proven in tui/launch.js, not a full reindex().
    try {
      const touched = [];
      scan({ onImport: (n) => touched.push(n) });
      if (touched.length) data.refreshMany(touched.map((n) => n.id));
    } catch {
      /* ignore */
    }
    if (!window.isDestroyed()) window.webContents.send('pty:exit', ptyId, exitCode);
  });

  return { ok: true, ptyId, cwd };
}

export function writeToPty(ptyId, chunk) {
  sessions.get(ptyId)?.proc.write(chunk);
}

export function resizePty(ptyId, cols, rows) {
  sessions.get(ptyId)?.proc.resize(cols, rows);
}

export function killPty(ptyId) {
  sessions.get(ptyId)?.proc.kill();
  sessions.delete(ptyId);
}
