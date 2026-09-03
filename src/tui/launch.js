import { existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { scan, allRaw, loadRaw } from '../scanner.js';
import { reindexMany, removeFromIndex } from '../index-db.js';
import { move, linkContinuation } from '../organize.js';
import { injectAgentsMd, dirsForFolder } from '../reuse.js';
import { menu, textPrompt } from './widgets/pickers.js';
import { foreground } from './foreground.js';
import { copyToClipboard } from './clipboard.js';
import { t } from './i18n.js';
import { AGENTS, which, binFor, resumeArgsFor, workDirFor, newCommandLine } from '../agents.js';

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
 *
 * Once the agent and directory are settled, offers the same "open here or
 * copy command" choice resume-handoff.js's onDetailEnter already offers for
 * resuming an EXISTING session — one shared shape instead of a separate
 * Shift+N keybinding for the copy-only path (removed; used to decide this
 * up front, before the agent/dir picker, rather than after). "Open here"
 * hands the terminal to the agent in the foreground — foreground() takes
 * over the SAME terminal/TTY (stdio: 'inherit') and blocks the whole TUI
 * until the child exits, so it's not how to get several sessions going at
 * once. "Copy command" instead copies the equivalent `cd <dir> && <bin>
 * <args>` shell command to the clipboard, to paste into a separate terminal
 * tab/window — the only way to get real parallelism, since only the human
 * (not this process) can open one.
 *
 * `copyOnly` (used only by tutorial.js's `n` step) skips the open-here/
 * copy-command choice entirely and always takes the copy path — a real
 * first-run tour must never risk foregrounding a real, possibly-billed
 * agent subprocess on a stray click.
 */
export function launchAgent(app, { folder, seed, parentId, title, defaultDir, copyOnly = false } = {}, done) {
  // MYCELIUM_DEMO_MODE (set for the tutorial's whole run) falls back to the
  // full registry instead of the real which()-filtered list — CI/most
  // contributors' machines have no agent CLI installed at all, which would
  // otherwise leave the picker with zero entries and the tutorial's `n`
  // step waiting forever for a modal that never opens. Unconditional in
  // demo mode (not just "when the real list is empty") so a tape/test run
  // is deterministic regardless of what happens to be on the recording
  // machine's PATH.
  const available =
    process.env.MYCELIUM_DEMO_MODE === '1'
      ? Object.entries(AGENTS)
      : Object.entries(AGENTS).filter(([, a]) => which(a.bin));
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
      resolveDir(app, folder, defaultDir, (dir) => {
        if (!dir) return done && done();
        if (copyOnly) return copyNewCommand(app, { agentKey, dir, folder, seed }, done);
        menu(
          app,
          t('launch.chooseAction'),
          [
            { label: t('resume.openHere'), value: 'here' },
            { label: t('resume.copyCommand'), value: 'copy' },
          ],
          (choice) => {
            if (choice === 'copy') return copyNewCommand(app, { agentKey, dir, folder, seed }, done);
            if (choice === 'here') return run(app, { agentKey, dir, folder, seed, parentId }, done);
            done && done();
          },
        );
      });
    },
  );
}

// Same AGENTS.md injection run() does before foregrounding — the whole
// point of injecting it is so the session that actually starts (wherever/
// however) has the folder's accumulated knowledge; skipping that just
// because this path doesn't itself launch anything would silently degrade
// whatever gets pasted from the clipboard.
function copyNewCommand(app, { agentKey, dir, folder, seed }, done) {
  if (folder) {
    try {
      injectAgentsMd(dir, folder);
    } catch {
      /* no KNOWLEDGE yet — fine, agent just starts fresh */
    }
  }
  const res = newCommandLine({ agentKey, dir, seed });
  if (!res.ok) {
    app.notify(res.error, 3);
    return done && done([]);
  }
  // Longer duration + the actual command line, not just "copied" — pasting
  // blind into a new tab without knowing what you're about to run isn't
  // great, and if the copy itself failed (no clipboard tool), showing the
  // line is how you'd get it at all.
  app.notify(copyToClipboard(res.line) ? t('resume.copied', res.line) : t('resume.copyFailed', res.line), 6);
  done && done([]);
}

function resolveDir(app, folder, defaultDir, cb) {
  // A chosen/typed directory that doesn't exist is created (mkdir -p) after
  // confirmation, rather than aborting — handing a session off to a fresh
  // workspace is a first-class flow (the whole point of h/n is to seed the
  // NEXT agent's dir with this folder's KNOWLEDGE via injectAgentsMd, and
  // that dir often doesn't exist yet). Shared by both the "open here" and
  // "copy command" branches since both route through here.
  const finish = (dir) => {
    if (!dir) return cb(null);
    // Canonicalize: strip trailing slashes, resolve to absolute path — so the
    // string cb() hands back matches what the spawned child later reports as
    // process.cwd() (foreground.js), which run() then compares to session-
    // captured cwds when filing the new session. A trailing slash on typed
    // input used to leave that comparison empty, so the new session wasn't
    // linked back to its origin.
    dir = resolve(dir.trim());
    if (existsSync(dir)) {
      // A file at that path is not usable — spawn would crash with ENOTDIR
      // deep inside foreground(). Reject upfront, same shape as mkdir failure.
      if (!statSync(dir).isDirectory()) {
        app.notify(t('launch.dirNotADirectory', dir), 4);
        return cb(null);
      }
      return cb(dir);
    }
    menu(
      app,
      t('launch.dirMissingPrompt', dir),
      [
        { label: t('launch.dirCreate'), value: 'create' },
        { label: t('launch.dirCreateCancel'), value: 'cancel' },
      ],
      (choice) => {
        if (choice !== 'create') return cb(null);
        try {
          mkdirSync(dir, { recursive: true });
          app.notify(t('launch.dirCreated', dir), 3);
          cb(dir);
        } catch (err) {
          app.notify(t('launch.dirCreateFailed', err.message), 4);
          cb(null);
        }
      },
    );
  };
  // Prefill the type prompt with the caller's suggested directory (handoff
  // passes the source session's own working dir) instead of the mycelium
  // process cwd, which is almost never where the next agent should run.
  const typePrompt = () => textPrompt(app, t('launch.dirPrompt', folder), defaultDir || process.cwd(), finish);

  // Offer the directories this folder's sessions already used — derived live
  // from actual session data (dirsForFolder()), not a remembered rule — no
  // need to retype long paths. The caller's defaultDir is offered too (even
  // if it no longer exists — finish() will offer to recreate it), so handing
  // off a session whose original dir is gone still surfaces that path.
  const dirs = dirsForFolder(folder);
  const suggestions = defaultDir && !dirs.includes(defaultDir) ? [defaultDir, ...dirs] : dirs;
  if (suggestions.length === 0) return typePrompt();

  const choices = [...suggestions.map((d) => ({ label: d, value: d })), { label: t('launch.typeManually'), value: '__type__' }];
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
      const res = scan({ onImport: (n) => touched.push(n) });
      // A resumed session's terminal may also be where a backlog item's copied
      // command was pasted — that item's record is gone now (scanner.js), so
      // its row has to leave the index rather than be re-added.
      for (const id of res.consumedBacklog) removeFromIndex(id);
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
      const scanRes = scan();
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
      for (const id of scanRes.consumedBacklog) removeFromIndex(id);
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
