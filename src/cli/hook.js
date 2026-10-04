import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INTERNAL_ENV } from '../llm.js';
import { sessionStartContext, captureEndedSession } from '../hook.js';
import { folderForDir } from '../reuse.js';
import { loadConfig, saveConfig } from '../config.js';
import { isSafeFolderPath } from '../paths.js';
import { fail, parseFlags } from './util.js';

function readHookInput() {
  if (process.stdin.isTTY) return {};
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

/**
 * `mycelium hook <session-start|session-end>` — invoked by the Claude Code
 * plugin (plugin/hooks/hooks.json) with the hook's JSON on stdin, not typed
 * by a person, so it's left out of printHelp() like `--tutorial`. Always
 * exits 0 with no stderr noise on its own failures: a hook is a best-effort
 * convenience and must never turn into a session-start/exit error.
 */
export function hookCmd(args) {
  // A `claude -p` complete() spawned (llm.js's childEnv()) — capturing or
  // briefing Mycelium's own meta-call would feed the next auto-tag cycle.
  if (process.env[INTERNAL_ENV] === '1') return;
  const [event] = args;
  const input = readHookInput();
  try {
    if (event === 'session-start') {
      const res = sessionStartContext({ cwd: input.cwd || process.cwd(), sessionId: input.session_id, source: input.source });
      if (!res) return;
      console.log(
        JSON.stringify({
          systemMessage: res.systemMessage,
          hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: res.additionalContext },
        }),
      );
    } else if (event === 'session-end') {
      captureEndedSession({ sessionId: input.session_id, transcriptPath: input.transcript_path });
    }
  } catch {
    /* best-effort — see the doc comment above */
  }
}

/**
 * `mycelium link [<folder>] [--dir D] [--unset]` — pin which folder a
 * directory belongs to, overriding folderForDir()'s guess (the most recent
 * filed session there). A human choice, so it's sticky the same way
 * `organizedBy: 'human'` is: nothing automatic ever rewrites it.
 */
export function linkCmd(args) {
  const { flags, positional } = parseFlags(args);
  const dir = resolve(typeof flags.dir === 'string' ? flags.dir : process.cwd());
  const cfg = loadConfig();
  const pins = { ...(cfg.dirFolders || {}) };
  const [folder] = positional;
  if (flags.unset) {
    delete pins[dir];
    saveConfig({ ...cfg, dirFolders: pins });
    return console.log(`unlinked ${dir}`);
  }
  if (folder) {
    if (!isSafeFolderPath(folder)) return fail(`invalid folder path: ${folder}`);
    pins[dir] = folder;
    saveConfig({ ...cfg, dirFolders: pins });
    return console.log(`${dir} → ${folder}`);
  }
  const current = folderForDir(dir);
  console.log(current ? `${dir} → ${current}${pins[dir] ? ' (linked)' : ' (inferred)'}` : `${dir} → (no folder)`);
}
