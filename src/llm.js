import { spawn } from 'node:child_process';

/**
 * Minimal LLM call via a headless coding-CLI subprocess. We reuse whatever
 * subscription the user already has (Claude Code / Codex) rather than asking
 * for a separate API key, and stay inside "ordinary scripted use" of the
 * official CLI — never touching auth tokens directly.
 *
 * Default provider is Claude Code with a cheap model, matching ai-memory's
 * choice of a small model for consolidation-style work.
 */
const PROVIDER = process.env.MYCELIUM_LLM || 'claude';
const CLAUDE_MODEL = process.env.MYCELIUM_CLAUDE_MODEL || 'haiku';
const CODEX_MODEL = process.env.MYCELIUM_CODEX_MODEL || 'gpt-5.5';

// Every complete() call is Mycelium's own internal LLM call (tagging/digest/
// knowledge), never a user request. The agent CLI stores the call itself as
// a new session file under the launch cwd, which scanner.js must recognize
// and drop — otherwise it comes back as a second, bogus "session" next to
// whatever the human was actually doing. Detecting that from prompt wording
// broke the moment a prompt got rewritten (it already did once); a fixed
// marker on every call is the part that can't drift.
export const META_MARKER = '​[mycelium:meta-call]​';

// Injection point — every LLM-dependent module (learn.js, insight.js,
// organize.js's classification, split.js) calls complete() rather than
// spawning directly, so overriding it here is the one seam needed to
// unit-test all of them without a real claude/codex subprocess. Real
// production callers never touch this. The one non-test caller is
// tui/tutorial.js's seedMockSessions(), for the same reason tests use it —
// deterministic output instead of a real subprocess — so the first-run
// tutorial / `mycelium demo` stays fast (though not literally instant on
// purpose, see tui/tutorial-mock-llm.js).
let _testProvider = null;
export function __setTestProvider(fn) {
  _testProvider = fn;
}
export function __clearTestProvider() {
  _testProvider = null;
}

export function complete(prompt, { timeoutMs = 240000 } = {}) {
  if (_testProvider) return Promise.resolve(_testProvider(prompt, { timeoutMs }));
  const fullPrompt = `${META_MARKER}\n${prompt}`;
  return new Promise((resolve, reject) => {
    let cmd, args;
    if (PROVIDER === 'codex') {
      cmd = 'codex';
      args = ['exec', fullPrompt, '--sandbox', 'read-only', '--skip-git-repo-check', '-c', 'approval_policy=never', '-m', CODEX_MODEL];
    } else {
      cmd = 'claude';
      args = ['-p', fullPrompt, '--model', CLAUDE_MODEL, '--output-format', 'json'];
    }

    // windowsHide: on Windows, spawn() opens a real visible console window
    // for a console-subsystem child by default (Node's own windowsHide
    // default is false) — with dozens of these calls firing in the
    // background, that's what looked like "Claude DOS windows keep
    // appearing" in practice (issue #3). No-op on macOS/Linux.
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('llm timeout'));
    }, timeoutMs);

    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(err.trim() || `${cmd} exited ${code}`));
      resolve(extractText(out));
    });
  });
}

export function extractText(stdout) {
  // Claude Code --output-format json wraps the reply in { result: "..." }.
  try {
    const j = JSON.parse(stdout);
    if (typeof j.result === 'string') return j.result;
  } catch {
    /* not claude json — fall through */
  }
  // Codex --json emits JSONL events; pull the last agent_message text.
  let last = null;
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e?.msg?.type === 'agent_message' && e.msg.message) last = e.msg.message;
      else if (e?.payload?.type === 'agent_message' && e.payload.message) last = e.payload.message;
    } catch {
      /* plain text line */
    }
  }
  return last ?? stdout.trim();
}

/**
 * Run `worker` over `items` with at most `concurrency` in flight at once —
 * the one place every LLM-bound batch caller (summarizeCandidates,
 * suggestPlacements, tagAll, the TUI's multi-select auto-tag) gets its
 * "how many claude/codex subprocesses may run at once" behavior from, so
 * the issue #3 lesson (unbounded concurrency piling up subprocesses) stays
 * enforced in exactly one place. A lane pool, not a chunk-and-Promise.all
 * loop: a new item starts the instant any lane frees up, instead of the
 * whole next chunk waiting on the slowest item in the current one.
 *
 * `stopAfterConsecutiveFailures`, when passed, turns on a circuit breaker:
 * `worker` must then return `{ ok }` (not just any value) so this can tell
 * a real failure from a real success. Once that many calls fail in a row
 * (a success resets the counter — a mixed bag of unrelated one-off
 * failures shouldn't trip this), no new items are started; in-flight lanes
 * still finish, the rest of `items` is left unprocessed. This exists
 * because a real usage-limit exhaustion (see "session 100% usage" reports
 * against a large first-time backlog) makes every subsequent call fail
 * identically — without it, a big backlog just burns through dozens more
 * doomed subprocess spawns one at a time instead of stopping once the
 * pattern is obvious. Deliberately NOT string-matching a specific vendor
 * error message (fragile — differs between claude/codex, changes across
 * CLI versions, and no single wording is guaranteed) — a run of
 * consecutive failures, regardless of cause, is itself the signal.
 * Omitted (the default, every pre-existing caller), this is a no-op:
 * `worker`'s return value isn't inspected at all, so callers whose worker
 * returns nothing (or anything else) keep working exactly as before.
 */
export async function mapConcurrent(items, concurrency, worker, { stopAfterConsecutiveFailures } = {}) {
  const results = new Array(items.length);
  let i = 0;
  let consecutiveFailures = 0;
  let stoppedEarly = false;
  async function lane() {
    while (i < items.length) {
      if (stoppedEarly) return;
      const idx = i++;
      const r = await worker(items[idx], idx);
      results[idx] = r;
      if (!stopAfterConsecutiveFailures) continue;
      if (r && r.ok === false) {
        consecutiveFailures++;
        if (consecutiveFailures >= stopAfterConsecutiveFailures) stoppedEarly = true;
      } else {
        consecutiveFailures = 0;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane));
  return { results, stoppedEarly };
}

/** Parse the first JSON object found in an LLM reply (they often wrap it in prose/fences). */
export function parseJsonReply(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}
