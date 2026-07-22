import { existsSync } from 'node:fs';

/**
 * Per-agent CLI wiring, shared by the TUI (src/tui/launch.js) and the plain
 * CLI (`mycelium resume`) so both resolve the same bin/args for a given
 * session source instead of maintaining two copies.
 */
export const AGENTS = {
  claude: { label: 'Claude Code', bin: 'claude', newArgs: (seed) => (seed ? [seed] : []) },
  codex: { label: 'Codex', bin: 'codex', newArgs: (seed) => (seed ? [seed] : []) },
  kiro: { label: 'Kiro', bin: 'kiro-cli', newArgs: (seed) => ['chat', ...(seed ? [seed] : [])] },
};

/** Which CLIs are actually installed → which agents we can offer. */
export function which(cmd) {
  const paths = (process.env.PATH || '').split(':');
  return paths.some((p) => p && existsSync(`${p}/${cmd}`));
}

export function binFor(source) {
  return { codex: 'codex', kiro: 'kiro-cli' }[source] ?? 'claude';
}

export function resumeArgsFor(source, sessionId) {
  return { codex: ['resume', sessionId], kiro: ['chat', '--resume-id', sessionId] }[source] ?? ['--resume', sessionId];
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
