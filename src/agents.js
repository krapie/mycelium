import { existsSync } from 'node:fs';
import { ADAPTERS, getAdapter } from './adapters/index.js';

/**
 * Per-agent CLI wiring, shared by the TUI (src/tui/launch.js) and the plain
 * CLI (`mycelium resume`) so both resolve the same bin/args for a given
 * session source instead of maintaining two copies. Derived from
 * adapters/index.js — each adapter now owns its own label/bin/newArgs/
 * resumeArgs alongside session parsing, so this is just a source-keyed view
 * of the same registry, not a second copy of the data.
 */
export const AGENTS = Object.fromEntries(ADAPTERS.map((a) => [a.name, a]));

/** Which CLIs are actually installed → which agents we can offer. */
export function which(cmd) {
  const paths = (process.env.PATH || '').split(':');
  return paths.some((p) => p && existsSync(`${p}/${cmd}`));
}

export function binFor(source) {
  return getAdapter(source)?.bin ?? 'claude';
}

export function resumeArgsFor(source, sessionId) {
  return getAdapter(source)?.resumeArgs(sessionId) ?? ['--resume', sessionId];
}

/**
 * The agent resolves --resume against the project dir it was launched from,
 * not the cwd recorded in messages — so prefer projectDir.
 */
export function workDirFor(session) {
  const candidates = [session.projectDir, session.cwd].filter(Boolean);
  return candidates.find((d) => existsSync(d)) || null;
}

const quoteArg = (s) => (/^[\w./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);

/** Build a copy-pasteable `cd <dir> && <bin> <args>` line — shared by
 * `mycelium resume` (CLI) and the TUI's "copy command" resume option. */
export function resumeCommandLine(session) {
  const bin = binFor(session.source);
  if (!which(bin)) return { ok: false, error: `${bin} not installed` };
  const cwd = workDirFor(session);
  if (!cwd) return { ok: false, error: 'no working directory found for this session' };
  const args = resumeArgsFor(session.source, session.id);
  return { ok: true, line: `cd ${quoteArg(cwd)} && ${quoteArg(bin)} ${args.map(quoteArg).join(' ')}`, bin, args, cwd };
}

/** Same shape as resumeCommandLine(), but for starting a brand-new session
 * (no existing session id to resume against) — there's no `n`/`h`
 * equivalent of "resume in place" that makes sense to skip, since launching
 * IS the whole action, so this only ever backs the TUI's "copy command"
 * alternative to launch.js's normal in-terminal foreground() handoff — see
 * launchAgent()'s `copyOnly` option. `agentKey` is one of AGENTS' own keys
 * (the same picker launch.js already uses to choose it). */
export function newCommandLine({ agentKey, dir, seed }) {
  const agent = AGENTS[agentKey];
  if (!agent) return { ok: false, error: 'unknown agent' };
  // MYCELIUM_DEMO_MODE (set for the tutorial's whole run, see tutorial.js's
  // startTutorial() and scanner.js's own identical branch) skips the real
  // which() check — CI/most contributors' machines have no agent CLI
  // installed at all, which would otherwise make the tutorial's copy-only
  // `n` step fail with "<bin> not installed" instead of the intended
  // "copied to clipboard" confirmation.
  if (process.env.MYCELIUM_DEMO_MODE !== '1' && !which(agent.bin)) {
    return { ok: false, error: `${agent.bin} not installed` };
  }
  if (!dir || !existsSync(dir)) return { ok: false, error: 'no working directory found' };
  const args = agent.newArgs(seed);
  return { ok: true, line: `cd ${quoteArg(dir)} && ${quoteArg(agent.bin)} ${args.map(quoteArg).join(' ')}`, bin: agent.bin, args, cwd: dir };
}
