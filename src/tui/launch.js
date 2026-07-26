import { existsSync } from 'node:fs';
import { scan, allRaw, loadRaw } from '../scanner.js';
import { reindexMany } from '../index-db.js';
import { move, addRule, cwdForFolder, linkContinuation } from '../organize.js';
import { injectAgentsMd } from '../reuse.js';
import { menu, textPrompt } from './widgets/pickers.js';
import { foreground } from './foreground.js';
import { t } from './i18n.js';
import { AGENTS, which, binFor, resumeArgsFor, workDirFor } from '../agents.js';

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

/**
 * The cockpit's headline flow. Pick an agent, resolve the folder's working
 * directory, inject that folder's ancestor-path knowledge into its AGENTS.md,
 * then hand the terminal to the real agent in the foreground (blessed leaves
 * and re-enters around it). On exit we scan, and file any newly-captured
 * session into the folder automatically.
 *
 * `seed` (optional) pre-fills the agent's first prompt — used by handoff to
 * continue a prior session on a different agent. `title` overrides the
 * agent-picker's label — used instead of a separate app.notify() toast when
 * there's context to explain (e.g. "resuming a merged/split session isn't
 * possible, picking an agent for a new one instead"): a toast shown right
 * before this picker opens doesn't get time to be read and visibly overlaps
 * it, since both are centered blessed overlays and the picker opens in the
 * same tick.
 */
export function launchAgent(app, { folder, seed, parentId, title } = {}, done) {
  const available = Object.entries(AGENTS).filter(([, a]) => which(a.bin));
  if (!available.length) {
    app.notify(t('launch.noAgents'), 3);
    return done && done();
  }

  menu(
    app,
    title || t('launch.selectAgent'),
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
      app.notify(t('launch.dirNotFound'), 3);
      return cb(null);
    }
    if (folder && dir !== known) addRule(dir, folder); // remember dir↔folder
    cb(dir);
  };
  const typePrompt = () => textPrompt(app, t('launch.dirPrompt', folder), known || process.cwd(), finish);

  // Offer the directories this folder's sessions already used — no need to
  // retype long paths.
  const dirs = dirsForFolder(folder);
  if (known && !dirs.includes(known) && existsSync(known)) dirs.unshift(known);
  if (dirs.length === 0) return typePrompt();

  const choices = [...dirs.map((d) => ({ label: d, value: d })), { label: t('launch.typeManually'), value: '__type__' }];
  menu(app, t('launch.selectDir', folder), choices, (val) => {
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
  const bin = binFor(session.source);
  if (!which(bin)) {
    app.notify(t('launch.binNotInstalled', bin), 3);
    return done && done();
  }
  const cwd = workDirFor(session);
  if (!cwd) {
    app.notify(t('launch.noWorkDir'), 4);
    return done && done();
  }
  const args = resumeArgsFor(session.source, session.id);
  foreground(app, bin, args, cwd, () => {
    // Resuming may extend the session (or, rarely, other terminals may have
    // captured sessions concurrently); re-capture and reindex only whatever
    // scan() actually touched instead of a full-store reindex() — this runs
    // on every single resume, so at a real session count that full rebuild
    // adds up fast for what's normally exactly one changed session.
    try {
      const touched = [];
      scan({ onImport: (n) => touched.push(n) });
      if (touched.length) reindexMany(touched); // nothing touched → index is already accurate
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
  foreground(app, agent.bin, agent.newArgs(seed), dir, () => {
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
      // `fresh` already covers everything scan() actually captured this
      // round (this launch's own session(s) plus anything concurrently
      // captured elsewhere) — reindexing just those instead of the whole
      // store avoids a full raw/ rebuild on every single agent launch.
      // move()/linkContinuation() above already re-saved `mine`'s raw files,
      // so re-read before indexing to pick up those changes.
      if (fresh.length) reindexMany(fresh.map((n) => loadRaw(n.id) || n));
      const note = parentId ? t('launch.continuedSession') : t('launch.newSession');
      app.notify(mine.length ? t('launch.captured', note, mine.length, folder || t('sessions.newBadge')) : t('launch.noNewSessions'), 3);
      if (done) return done(mine);
    } catch (err) {
      app.notify(t('launch.captureFailed', err.message), 3);
    }
    if (done) done([]);
  });
}
