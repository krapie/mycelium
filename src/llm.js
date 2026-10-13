import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';

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

// Injection point — every LLM-dependent module calls complete() rather than
// spawning directly, so overriding it here is the one seam needed to
// unit-test all of them. The one non-test caller is tui/tutorial.js's
// seedMockSessions(), for the same deterministic-output reason.
let _testProvider = null;
export function __setTestProvider(fn) {
  _testProvider = fn;
}
export function __clearTestProvider() {
  _testProvider = null;
}

// Directories a caller (the editor, via the bridge's `extraPath`) knows the
// agent CLI may live in although this process was started without them.
// AsyncLocalStorage so concurrent requests each see their own, without
// threading an option through every learn/organize/insight function.
const agentPath = new AsyncLocalStorage();
export function withAgentPath(dirs, fn) {
  return Array.isArray(dirs) && dirs.length ? agentPath.run(dirs, fn) : fn();
}

function spawnEnv() {
  const dirs = agentPath.getStore();
  if (!dirs) return process.env;
  // Windows env keys are case-insensitive ('Path'); reuse whichever spelling exists.
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  return { ...process.env, [key]: [...dirs, process.env[key]].filter(Boolean).join(delimiter) };
}

/** The program complete() will spawn, or null under the test provider (nothing is spawned). */
export function providerBin() {
  return _testProvider ? null : PROVIDER === 'codex' ? 'codex' : 'claude';
}

// Every in-flight complete() child, tracked so killInFlight() (app.js's
// quit()/Ctrl+C) can actually stop them — real bug: nothing tracked these
// beyond the local Promise closure, so quit()'s process.exit() left a
// still-running claude/codex subprocess orphaned, consuming quota after exit.
const inFlight = new Set();

// Test-only seam, same naming/purpose convention as __setTestProvider()
// above — complete()'s real spawn() path always targets the real claude/
// codex binaries with fixed args (no injection point for a test double),
// and _testProvider deliberately bypasses spawn() entirely (no subprocess
// at all), so neither path can exercise killInFlight()'s real behavior
// against a tracked child. This lets a test register a fake child (any
// object with a `.kill()` method) directly, without a real subprocess.
export function __trackChildForTest(child) {
  inFlight.add(child);
}
export function __inFlightCountForTest() {
  return inFlight.size;
}
export function __clearInFlightForTest() {
  inFlight.clear();
}

/** Best-effort SIGTERM to every currently-tracked complete() child — see
 * `inFlight`'s own comment above. Not awaited by the caller: the goal is
 * "don't leave it running," not "block quitting until it's confirmed
 * dead" — each child's own `close`/`error` handler removes it from
 * `inFlight` once it actually exits, same as the normal completion path. */
export function killInFlight() {
  for (const child of inFlight) child.kill('SIGTERM');
}

// Without --no-session-persistence, Claude Code saves every one of these
// headless calls as a session under ~/.claude/projects/<cwd>/: scan() skips
// them (META_MARKER), but they pile up in `claude --resume` and change the
// agent's own store behind the user's back (#149). Older CLIs don't know the
// flag; the first such rejection turns it off for the rest of the process.
let claudeSupportsNoPersistence = true;

export function claudeArgs(fullPrompt, { persist = !claudeSupportsNoPersistence } = {}) {
  const args = ['-p', fullPrompt, '--model', CLAUDE_MODEL, '--output-format', 'json'];
  if (!persist) args.push('--no-session-persistence');
  return args;
}

export function isUnknownNoPersistenceFlag(stderr) {
  return /unknown option/i.test(stderr) && /no-session-persistence/.test(stderr);
}

/**
 * Rough cause of a failed complete(), from its error text. Deliberately
 * lenient pattern-matching used only to pick which message to SHOW — and to
 * stop a batch early on 'missing' (agent CLI not installed), where retrying
 * can't help. Otherwise never control flow: mapConcurrent's breaker still
 * trips on any run of failures. 'usage' wins over 'auth' when both match.
 */
export function classifyLlmError(message) {
  const m = String(message || '');
  if (/\bnot installed\b|\bENOENT\b/.test(m)) return 'missing';
  if (/rate.?limit|usage.?limit|limit reached|quota|too many requests|\b429\b|overloaded|credit balance/i.test(m)) return 'usage';
  if (/credential|log ?in\b|logged out|unauthori[sz]ed|authenticat|\btoken\b|not a terminal|not a tty|api key|\b401\b|\b403\b/i.test(m)) return 'auth';
  if (/llm timeout/i.test(m)) return 'timeout';
  return 'other';
}

/**
 * One tiny call to find out whether the agent CLI can answer right now, so
 * a background cycle can skip itself instead of spawning calls that are
 * bound to fail (each can block for the full 240s timeout). Resolves to
 * null when healthy, else the error message.
 */
export async function llmPreflight({ timeoutMs = 45000 } = {}) {
  try {
    await complete('Reply with the single word: ok', { timeoutMs });
    return null;
  } catch (err) {
    return err.message || String(err);
  }
}

export async function complete(prompt, { timeoutMs = 240000 } = {}) {
  if (_testProvider) return _testProvider(prompt, { timeoutMs });
  const fullPrompt = `${META_MARKER}\n${prompt}`;
  if (PROVIDER === 'codex') {
    return runCli('codex', ['exec', fullPrompt, '--sandbox', 'read-only', '--skip-git-repo-check', '-c', 'approval_policy=never', '-m', CODEX_MODEL], timeoutMs);
  }
  try {
    return await runCli('claude', claudeArgs(fullPrompt), timeoutMs);
  } catch (err) {
    if (!claudeSupportsNoPersistence || !isUnknownNoPersistenceFlag(err.message)) throw err;
    claudeSupportsNoPersistence = false;
    return runCli('claude', claudeArgs(fullPrompt), timeoutMs);
  }
}

// A shared tmpdir() is writable by other users, who could plant a CLAUDE.md/
// AGENTS.md there for the agent CLI to load. mkdtemp creates the directory
// 0700, so one private empty dir per process is both neutral and safe.
let _neutralCwd = null;
function neutralCwd() {
  if (_neutralCwd) return _neutralCwd;
  _neutralCwd = mkdtempSync(join(tmpdir(), 'mycelium-llm-'));
  process.on('exit', () => rmSync(_neutralCwd, { recursive: true, force: true }));
  return _neutralCwd;
}

function runCli(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    // windowsHide: on Windows, spawn() opens a real visible console window
    // for a console-subsystem child by default (Node's own windowsHide
    // default is false) — with dozens of these calls firing in the
    // background, that's what looked like "Claude DOS windows keep
    // appearing" in practice (issue #3). No-op on macOS/Linux.
    // cwd: a neutral dir, not the launch dir — otherwise the agent CLI loads
    // that project's CLAUDE.md/AGENTS.md, hooks and MCP servers, which is
    // slower and lets the model start working on project instructions
    // instead of answering the one-shot prompt (pushing it into the timeout).
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, cwd: neutralCwd(), env: spawnEnv() });
    inFlight.add(child);
    const untrack = () => inFlight.delete(child);
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
      untrack();
      // Same wording as agents.js's "<bin> not installed", which the VS Code
      // extension already retries with the login shell's PATH.
      reject(e.code === 'ENOENT' ? Object.assign(new Error(`${cmd} not installed`), { code: 'ENOENT' }) : e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      untrack();
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
      // A failure no retry can fix (the agent CLI isn't installed): stop now,
      // not after N doomed calls.
      if (r && r.fatal) stoppedEarly = true;
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
