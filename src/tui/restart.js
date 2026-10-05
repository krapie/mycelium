/**
 * Replace this process with a fresh copy of itself (same argv, same env), so
 * a setting read once at startup — the UI locale — takes effect. execve keeps
 * the PID and terminal and leaves nothing behind; a spawned child would leave
 * this process alive underneath, still running the in-process upkeep timers.
 * Returns false where execve isn't available (Windows, older Node) so the
 * caller can fall back to quitting.
 */
export function relaunch({
  execve = process.execve,
  platform = process.platform,
  execPath = process.execPath,
  argv = process.argv,
  env = process.env,
} = {}) {
  if (typeof execve !== 'function' || platform === 'win32') return false;
  execve(execPath, [execPath, ...argv.slice(1)], env);
  return true;
}
