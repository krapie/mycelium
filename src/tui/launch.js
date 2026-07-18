import { existsSync } from 'node:fs';
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
  const def = known || process.cwd();
  textPrompt(app, `작업 디렉토리${folder ? ` (${folder})` : ''}`, def, (dir) => {
    if (!dir) return cb(null);
    dir = dir.trim();
    if (!existsSync(dir)) {
      app.notify('디렉토리가 존재하지 않습니다', 3);
      return cb(null);
    }
    // Remember this dir↔folder mapping so future sessions auto-file here.
    if (folder && dir !== known) addRule(dir, folder);
    cb(dir);
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
  app.screen.exec(bin, args, { cwd }, () => {
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

  // blessed leaves the alternate screen, runs the agent in the foreground,
  // and re-enters afterward. This is the k9s "shell into a pod" pattern.
  app.screen.exec(agent.bin, agent.args(seed), { cwd: dir }, () => {
    // Back in the TUI: capture whatever the agent produced.
    try {
      scan();
      reindex();
      const now = allRaw();
      const fresh = now.filter((n) => !before.has(n.id));
      if (folder) for (const n of fresh) if (n.organizedBy !== 'human') move(n.id, folder);
      // If this was a handoff, mark the new session(s) as a continuation of the parent.
      if (parentId) for (const n of fresh) linkContinuation(n.id, parentId);
      reindex();
      const note = parentId ? '이어받은 세션' : '새 세션';
      app.notify(fresh.length ? `${note} ${fresh.length}개 캡처 → ${folder || '_inbox'}` : '새 세션 없음', 3);
    } catch (err) {
      app.notify(`캡처 실패: ${err.message}`, 3);
    }
    if (done) done();
  });
}
