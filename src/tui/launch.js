import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { scan, allRaw } from '../scanner.js';
import { reindex } from '../index-db.js';
import { move, addRule, cwdForFolder, linkContinuation } from '../organize.js';
import { injectAgentsMd } from '../reuse.js';
import { menu, textPrompt } from './widgets/pickers.js';

// Which CLIs are actually installed → which agents we can offer.
function which(cmd) {
  const paths = (process.env.PATH || '').split(':');
  return paths.some((p) => p && existsSync(`${p}/${cmd}`));
}

/**
 * Run a full-screen program in the foreground and cleanly return to the TUI.
 * blessed's own screen.exec left the two UIs merged; a bare leave/enter fixed
 * the launch but broke the return (input raw-mode + mouse weren't restored).
 * This replicates blessed's full spawn suspend/resume: exit the alt buffer and
 * hand over raw stdin, then on exit restore raw-mode/mouse/alt-buffer and force
 * a full redraw.
 */
function foreground(app, bin, args, cwd, after) {
  const screen = app.screen;
  const program = screen.program;
  const input = program.input;
  const mouseWasOn = program.mouseEnabled;

  // --- suspend blessed, give the raw terminal to the child ---
  try {
    program.saveCursor();
    program.normalBuffer(); // leave alternate screen
    program.showCursor();
    if (mouseWasOn) program.disableMouse();
    if (input.setRawMode) input.setRawMode(false);
    input.pause();
  } catch {
    /* ignore */
  }

  let resumed = false;
  const resume = () => {
    if (resumed) return;
    resumed = true;
    try {
      input.resume();
      if (input.setRawMode) input.setRawMode(true);
      program.alternateBuffer(); // re-enter alternate screen
      program.hideCursor();
      if (mouseWasOn) program.enableMouse();
      if (typeof screen.alloc === 'function') screen.alloc(); // blank buffer → full redraw
    } catch {
      /* ignore */
    }
    try {
      after();
    } finally {
      screen.render();
    }
  };

  let child;
  try {
    child = spawn(bin, args, { cwd, stdio: 'inherit' });
  } catch {
    return resume();
  }
  child.on('error', resume);
  child.on('exit', resume);
}

/** Distinct existing working directories of the sessions in a folder subtree. */
function dirsForFolder(folder) {
  if (!folder) return [];
  const set = new Set();
  for (const n of allRaw()) {
    const inFolder = n.folder === folder || (n.folder && n.folder.startsWith(folder + '/'));
    if (!inFolder) continue;
    const d = n.projectDir || n.cwd;
    if (d && existsSync(d)) set.add(d);
  }
  return [...set];
}

const AGENTS = {
  claude: { label: 'Claude Code', bin: 'claude', args: (seed) => (seed ? [seed] : []) },
  codex: { label: 'Codex', bin: 'codex', args: (seed) => (seed ? [seed] : []) },
};

/**
 * The cockpit's headline flow. Pick an agent, resolve the folder's working
 * directory, inject that folder's ancestor-path knowledge into its AGENTS.md,
 * then hand the terminal to the real agent in the foreground (blessed leaves
 * and re-enters around it). On exit we scan, and file any newly-captured
 * session into the folder automatically.
 *
 * `seed` (optional) pre-fills the agent's first prompt — used by handoff to
 * continue a prior session on a different agent.
 */
export function launchAgent(app, { folder, seed, parentId } = {}, done) {
  const available = Object.entries(AGENTS).filter(([, a]) => which(a.bin));
  if (!available.length) {
    app.notify('설치된 에이전트(claude/codex)가 없습니다', 3);
    return done && done();
  }

  menu(
    app,
    '에이전트 선택',
    available.map(([k, a]) => ({ label: a.label, value: k })),
    (agentKey) => {
      if (!agentKey) return done && done();
      resolveDir(app, folder, (dir) => {
        if (!dir) return done && done();
        run(app, { agentKey, dir, folder, seed, parentId }, done);
      });
    },
  );
}

function resolveDir(app, folder, cb) {
  const known = folder ? cwdForFolder(folder) : null;
  const finish = (dir) => {
    if (!dir) return cb(null);
    dir = dir.trim();
    if (!existsSync(dir)) {
      app.notify('디렉토리가 존재하지 않습니다', 3);
      return cb(null);
    }
    if (folder && dir !== known) addRule(dir, folder); // remember dir↔folder
    cb(dir);
  };
  const typePrompt = () => textPrompt(app, `작업 디렉토리${folder ? ` (${folder})` : ''}`, known || process.cwd(), finish);

  // Offer the directories this folder's sessions already used — no need to
  // retype long paths.
  const dirs = dirsForFolder(folder);
  if (known && !dirs.includes(known) && existsSync(known)) dirs.unshift(known);
  if (dirs.length === 0) return typePrompt();

  const choices = [...dirs.map((d) => ({ label: d, value: d })), { label: '+ 직접 입력…', value: '__type__' }];
  menu(app, `작업 디렉토리 선택 (${folder})`, choices, (val) => {
    if (val === undefined) return cb(null);
    if (val === '__type__') return typePrompt();
    finish(val);
  });
}

/**
 * Resume an existing session in its ORIGINAL agent — the true "reopen this
 * exact conversation" (vs. handoff, which starts a new session on possibly a
 * different agent with the context injected). Uses each CLI's native resume.
 */
export function resumeSession(app, session, done) {
  const bin = session.source === 'codex' ? 'codex' : 'claude';
  if (!which(bin)) {
    app.notify(`${bin}가 설치되어 있지 않습니다`, 3);
    return done && done();
  }
  // The agent resolves --resume against the project dir it was launched from,
  // not the cwd recorded in messages — so prefer projectDir.
  const candidates = [session.projectDir, session.cwd].filter(Boolean);
  const cwd = candidates.find((d) => existsSync(d));
  if (!cwd) {
    app.notify(`원래 작업 디렉토리가 없어 이어열 수 없습니다 (워크트리 삭제 등). 핸드오프(h)를 쓰세요.`, 4);
    return done && done();
  }
  const args = session.source === 'codex' ? ['resume', session.id] : ['--resume', session.id];
  foreground(app, bin, args, cwd, () => {
    // Resuming may extend the session; re-capture it.
    try {
      scan();
      reindex();
    } catch {
      /* ignore */
    }
    if (done) done();
  });
}

function run(app, { agentKey, dir, folder, seed, parentId }, done) {
  const agent = AGENTS[agentKey];

  // Inject the folder's knowledge so the agent starts context-aware.
  if (folder) {
    try {
      injectAgentsMd(dir, folder);
    } catch {
      /* no KNOWLEDGE yet — fine, agent just starts fresh */
    }
  }

  const before = new Set(allRaw().map((n) => n.id));

  // Hand the terminal to the agent in the foreground; capture on return.
  // (k9s "shell into a pod" pattern.)
  foreground(app, agent.bin, agent.args(seed), dir, () => {
    // Back in the TUI: capture whatever the agent produced.
    try {
      scan();
      const now = allRaw();
      const fresh = now.filter((n) => !before.has(n.id));
      // scan() captures ALL new sessions on the system — including anything
      // created concurrently in other terminals/projects. Only the session(s)
      // actually produced in THIS launch's working dir belong to this folder.
      const inLaunchDir = (n) => {
        const d = n.projectDir || n.cwd || '';
        return d === dir || d.startsWith(dir + '/');
      };
      const mine = fresh.filter(inLaunchDir);
      if (folder) for (const n of mine) if (n.organizedBy !== 'human') move(n.id, folder);
      if (parentId) for (const n of mine) linkContinuation(n.id, parentId);
      reindex();
      const note = parentId ? '이어받은 세션' : '새 세션';
      app.notify(mine.length ? `${note} ${mine.length}개 → ${folder || '_inbox'}` : '이 디렉토리의 새 세션 없음', 3);
    } catch (err) {
      app.notify(`캡처 실패: ${err.message}`, 3);
    }
    if (done) done();
  });
}
