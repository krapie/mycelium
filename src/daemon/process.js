import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync, openSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runDaemon } from './cycles.js';
import { ensureDirs, DAEMON_PID_PATH, DAEMON_LOG_PATH } from '../paths.js';

// OS process-lifecycle concerns (spawning/detaching/pidfiles) — kept
// separate from cycles.js's cadence/policy layer.

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run the upkeep loop inside the TUI's own process instead of a separate
 * detached one — called once from the TUI on launch. This replaced an
 * earlier design that auto-spawned a long-lived detached `mycelium daemon`
 * process on every TUI launch: that process kept running old in-memory code
 * across TUI restarts, so code changes silently stopped taking effect until
 * someone remembered to `mycelium daemon --stop` it (a real bug hit once).
 * Running in-process means every `mycelium` launch always runs the current
 * code, and upkeep naturally stops when the TUI exits — no separate process
 * to leak or go stale. Output goes to DAEMON_LOG_PATH, not stdout — blessed
 * owns the terminal, so raw console writes would corrupt the screen.
 * Opt-out via MYCELIUM_NO_AUTOSTART (used by automated TUI smoke tests to
 * avoid triggering real LLM calls in the background).
 */
export function startTuiRoutine() {
  if (process.env.MYCELIUM_NO_AUTOSTART) return;
  ensureDirs();
  const fileLog = {
    log: (...args) => appendFileSync(DAEMON_LOG_PATH, `[${new Date().toISOString()}] ${args.join(' ')}\n`),
    error: (...args) => appendFileSync(DAEMON_LOG_PATH, `[${new Date().toISOString()}] ${args.join(' ')}\n`),
  };
  runDaemon({ log: fileLog });
}

/**
 * Spawn a detached daemon if one isn't already running (pidfile-based,
 * idempotent) — for anyone who explicitly wants background upkeep to keep
 * running even while the TUI itself is closed (`mycelium daemon --detach`).
 * Not used by the TUI itself anymore — see startTuiRoutine() above.
 */
export function spawnDetachedDaemon() {
  ensureDirs();
  if (existsSync(DAEMON_PID_PATH)) {
    const pid = Number(readFileSync(DAEMON_PID_PATH, 'utf8').trim());
    if (pid && isAlive(pid)) return { started: false, pid };
  }
  const cliPath = fileURLToPath(new URL('../cli.js', import.meta.url));
  const log = openSync(DAEMON_LOG_PATH, 'a');
  const child = spawn(process.execPath, [cliPath, 'daemon'], {
    detached: true,
    stdio: ['ignore', log, log],
  });
  child.unref();
  writeFileSync(DAEMON_PID_PATH, String(child.pid));
  return { started: true, pid: child.pid };
}

/** Stop a daemon started via spawnDetachedDaemon(), if running. */
export function stopDetachedDaemon() {
  if (!existsSync(DAEMON_PID_PATH)) return { stopped: false, reason: 'not running' };
  const pid = Number(readFileSync(DAEMON_PID_PATH, 'utf8').trim());
  const stopped = pid && isAlive(pid);
  if (stopped) process.kill(pid);
  rmSync(DAEMON_PID_PATH, { force: true });
  return { stopped, pid };
}
