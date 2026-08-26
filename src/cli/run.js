import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { loadConfig, saveConfig } from '../config.js';
import { fail, parseFlags } from './util.js';

export async function daemonCmd(args) {
  const { flags } = parseFlags(args);
  if (flags.stop) {
    const { stopDetachedDaemon } = await import('../daemon.js');
    const res = stopDetachedDaemon();
    console.log(res.stopped ? `daemon stopped (pid ${res.pid})` : 'daemon is not running');
    return;
  }
  if (flags.detach) {
    const { spawnDetachedDaemon } = await import('../daemon.js');
    const res = spawnDetachedDaemon();
    console.log(res.started ? `daemon started (pid ${res.pid})` : `daemon already running (pid ${res.pid})`);
    return;
  }
  const { runDaemon } = await import('../daemon.js');
  await runDaemon();
}

// Runs the tutorial against a completely separate store — never the real
// ~/.mycelium — so it's safe to fire in the middle of a live demo without
// exposing personal projects. Only child_process.spawn() guarantees this:
// MYCELIUM_HOME is read once, at module load, by paths.js, and this
// process's own imports (already evaluated by the time this runs) are far
// too late to change that — same reasoning as daemon.js's spawnDetachedDaemon().
export async function demoCmd() {
  const { join } = await import('node:path');
  const { homedir } = await import('node:os');
  const { existsSync, rmSync } = await import('node:fs');
  const demoHome = join(homedir(), '.mycelium-demo');
  if (existsSync(demoHome)) rmSync(demoHome, { recursive: true, force: true });
  // Fired off now, awaited only later in the handoff branch below — the
  // tutorial takes tens of seconds, plenty of time for this cold import
  // (nearly the whole app) to resolve in the background instead of
  // blocking visibly in the gap between child exit and real screen paint.
  const tuiIndexPromise = import('../tui/index.js');
  const child = spawn(process.execPath, [process.argv[1], 'tui', '--tutorial'], {
    // MYCELIUM_DEMO_MODE: scanner.js's own guard against pulling real
    // session content into this throwaway store — see its comment.
    env: { ...process.env, MYCELIUM_HOME: demoHome, MYCELIUM_DEMO_MODE: '1' },
    stdio: 'inherit',
  });
  return new Promise((resolve) => {
    child.on('exit', async (code) => {
      const { DEMO_HANDOFF_EXIT_CODE } = await import('../tui/tutorial.js');
      if (code === DEMO_HANDOFF_EXIT_CODE) {
        // Actively discard stdin for the handoff: an impatient repeat
        // `q` typed in the gap between child exit and the real TUI's
        // raw-mode reader starting arrives as a live press otherwise
        // (confirmed via VHS). The 120ms wait is load-bearing —
        // resume()'s read isn't synchronous.
        const discardStdin = () => {};
        if (process.stdin.isTTY) {
          process.stdin.resume();
          process.stdin.on('data', discardStdin);
          await new Promise((r) => setTimeout(r, 120));
        }
        // Full tutorial completion — hand off in-process (this
        // process's own env was never touched, only the child's).
        // Carry the demo's picked language, but only on this
        // full-completion path — an early Esc bail shouldn't silently
        // change real settings.
        try {
          const demoConfigPath = join(demoHome, 'config.json');
          if (existsSync(demoConfigPath)) {
            const demoCfg = JSON.parse(readFileSync(demoConfigPath, 'utf8'));
            if (demoCfg.locale) {
              const { setLocale } = await import('../tui/i18n.js');
              setLocale(demoCfg.locale);
            }
          }
        } catch {
          // Best-effort — a missing/malformed demo config just means
          // the real tool keeps whatever language it already had, not
          // a hard failure blocking the handoff itself.
        }
        // Printed immediately, before the real-TUI mount work below —
        // console.log() is safe since screen.destroy() already restored
        // cooked mode. Without this, the silent gap read as "did that
        // even do anything?", risking a second stray q.
        const { t } = await import('../tui/i18n.js');
        console.log(t('demo.handoffTransition'));
        // Real bug: on a real ~/.mycelium that's also never been
        // onboarded, runTui() would show its own first-run prompt right
        // on top of the demo just finished. Mark it onboarded here, same
        // as finishing/declining the real tutorial already does — this
        // only runs on full completion, so it's equivalent real onboarding.
        saveConfig({ ...loadConfig(), onboarded: true });
        // Awaits the SAME promise kicked off right after spawning the
        // child above — already resolved (or resolving) by now, so this
        // is near-instant instead of paying the full cold-import cost
        // here in the visible gap.
        const { runTui } = await tuiIndexPromise;
        if (process.stdin.isTTY) {
          process.stdin.removeListener('data', discardStdin);
          process.stdin.pause();
        }
        await runTui();
      } else {
        process.exitCode = code ?? 0;
      }
      resolve();
    });
  });
}

export async function langCmd(args) {
  const { getLocale, setLocale } = await import('../tui/i18n.js');
  const [locale] = args;
  if (!locale) {
    console.log(`current: ${getLocale()}`);
    return;
  }
  if (locale !== 'en' && locale !== 'ko') return fail('Usage: mycelium lang <en|ko>');
  setLocale(locale);
  console.log(`language set to ${locale} (applies to the TUI on next launch)`);
}
