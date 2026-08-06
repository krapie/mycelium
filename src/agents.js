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

/** Build a copy-pasteable `cd <dir> && <bin> <args>` line — shared by
 * `mycelium resume` (CLI) and the TUI's "copy command" resume option. */
export function resumeCommandLine(session) {
  const bin = binFor(session.source);
  if (!which(bin)) return { ok: false, error: `${bin} not installed` };
  const cwd = workDirFor(session);
  if (!cwd) return { ok: false, error: 'no working directory found for this session' };
  const args = resumeArgsFor(session.source, session.id);
  const quote = (s) => (/^[\w./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);
  return { ok: true, line: `cd ${quote(cwd)} && ${quote(bin)} ${args.map(quote).join(' ')}`, bin, args, cwd };
}
