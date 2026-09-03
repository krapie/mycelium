import { spawn } from 'node:child_process';
import { which } from './agents.js';
import { ADAPTERS, getAdapter } from './adapters/index.js';

/**
 * Minimal LLM call via a headless coding-CLI subprocess. We reuse whatever
 * subscription the user already has (Claude Code / Codex / Kiro / OpenCode)
 * rather than asking for a separate API key, and stay inside "ordinary
 * scripted use" of the official CLI — never touching auth tokens directly.
 *
 * Provider selection: MYCELIUM_LLM wins when set (honored verbatim). With it
 * unset we auto-detect — the first CLI in ADAPTERS' canonical order that is
 * both installed and one complete() actually knows how to drive headless,
 * falling back to 'claude' so nothing is ever worse than the old hardcoded
 * default (issue #86: a codex/kiro/opencode-only user had every LLM feature
 * fail with an inscrutable `spawn claude ENOENT`).
 */
// An adapter is eligible to back complete() exactly when it defines
// headlessArgs() — see adapters/base.js. Deriving eligibility from the
// contract rather than a name list here is what keeps "adding an agent CLI
// touches two files" true. All four current adapters define it; an adapter
// for a CLI with no verified non-interactive mode would simply omit it and
// stay capture/resume-only.
const invocable = (a) => typeof a?.headlessArgs === 'function';

// Both surfaced through each caller's `LLM failed: ${err.message}`. spawn's own
// `spawn claude ENOENT` reads as "this tool is broken" and names no fix.
export const NO_AGENT_CLI_MESSAGE =
  'no LLM agent CLI found — install claude, codex, kiro-cli, or opencode, set MYCELIUM_LLM to the one you have, or run `mycelium demo` (needs no agent CLI)';
export const unusableProviderMessage = (provider) =>
  `MYCELIUM_LLM="${provider}" can't run headless — set it to ${ADAPTERS.filter(invocable)
    .map((a) => a.name)
    .join(' or ')}, or unset it to auto-detect`;

// Only the PATH scan is memoized; MYCELIUM_LLM is re-read every call so it's
// honored the instant it changes. __resetProviderCacheForTest() clears this.
let _autoProvider = null;
function resolveProvider() {
  const forced = process.env.MYCELIUM_LLM;
  if (forced) return forced;
  if (_autoProvider) return _autoProvider;
  for (const a of ADAPTERS) {
    if (invocable(a) && which(a.bin)) return (_autoProvider = a.name);
  }
  return (_autoProvider = 'claude');
}

// Test-only, same convention as __setTestProvider() below: let a test drive
// resolveProvider() against a temp PATH without spawning, and reset the memo
// between PATH states.
export function __resolveProviderForTest() {
  return resolveProvider();
}
export function __resetProviderCacheForTest() {
  _autoProvider = null;
}

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

export function complete(prompt, { timeoutMs = 240000 } = {}) {
  if (_testProvider) return Promise.resolve(_testProvider(prompt, { timeoutMs }));
  const fullPrompt = `${META_MARKER}\n${prompt}`;
  const provider = resolveProvider();
  const agent = getAdapter(provider);
  // Only reachable via an explicit MYCELIUM_LLM — resolveProvider()'s own
  // fallback is always invocable. Erroring beats silently running a different
  // agent than the one the user named.
  if (!invocable(agent)) return Promise.reject(new Error(unusableProviderMessage(provider)));
  const cmd = agent.bin;
  const args = agent.headlessArgs(fullPrompt);
  return new Promise((resolve, reject) => {
    // windowsHide: on Windows, spawn() opens a real visible console window
    // for a console-subsystem child by default (Node's own windowsHide
    // default is false) — with dozens of these calls firing in the
    // background, that's what looked like "Claude DOS windows keep
    // appearing" in practice (issue #3). No-op on macOS/Linux.
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
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
      reject(e.code === 'ENOENT' ? new Error(NO_AGENT_CLI_MESSAGE) : e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      untrack();
      if (code !== 0) return reject(new Error(err.trim() || `${cmd} exited ${code}`));
      resolve(extractText(out));
    });
  });
}

// ESC (0x1b) can't appear as a literal in a regex here — eslint:recommended's
// no-control-regex forbids it — so the ANSI matcher is built from a string.
const ESC = String.fromCharCode(27);
const ANSI_SGR = new RegExp(ESC + '\\[[0-9;]*m', 'g');

export function extractText(stdout) {
  // Claude Code --output-format json wraps the reply in { result: "..." }.
  try {
    const j = JSON.parse(stdout);
    if (typeof j.result === 'string') return j.result;
  } catch {
    /* not claude json — fall through */
  }
  // Codex --json and opencode `run --format json` both emit JSONL events.
  // Codex: the last agent_message. Opencode: every { type: "text" } part
  // (its `part.text`), in order — one for a plain reply, several when the
  // model interleaves text with tool steps.
  let last = null;
  const opencodeText = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e?.msg?.type === 'agent_message' && e.msg.message) last = e.msg.message;
      else if (e?.payload?.type === 'agent_message' && e.payload.message) last = e.payload.message;
      else if (e?.type === 'text' && typeof e.part?.text === 'string') opencodeText.push(e.part.text);
    } catch {
      /* plain text line */
    }
  }
  if (last != null) return last;
  if (opencodeText.length) return opencodeText.join('\n');
  // Kiro CLI's `chat --no-interactive` has no structured-output mode: it
  // prints the reply as RENDERED terminal text — SGR colour codes around
  // the answer, a leading "> " speaker marker, markdown fences rendered
  // away. Any ESC byte means we're looking at that shape; strip the
  // decoration so parseJsonReply() (every caller's next step) sees clean text.
  if (stdout.includes(ESC)) {
    return stdout.replace(ANSI_SGR, '').replace(/^\s*>\s?/, '').trim();
  }
  return stdout.trim();
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
