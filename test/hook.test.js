import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers.js';

const homeDir = useTempHome();

const { emptyNeutral } = await import('../src/schema.js');
const { saveRaw, loadRaw } = await import('../src/scanner.js');
const { reindex, sessionsInDir } = await import('../src/index-db.js');
const { mkdir } = await import('../src/organize.js');
const { TREE_DIR } = await import('../src/paths.js');
const { loadConfig, saveConfig } = await import('../src/config.js');
const { folderForDir } = await import('../src/reuse.js');
const { sessionStartContext, captureEndedSession } = await import('../src/hook.js');
const { childEnv, INTERNAL_ENV } = await import('../src/llm.js');
const adaptersIndex = await import('../src/adapters/index.js');

const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));

// Real directories under the OS temp dir — folderForDir() walks parents and
// stops at $HOME, so these must not sit under the developer's home.
const projDir = mkdtempSync(join(tmpdir(), 'mycelium-proj-'));
const subDir = join(projDir, 'packages', 'api');
mkdirSync(subDir, { recursive: true });
const otherDir = mkdtempSync(join(tmpdir(), 'mycelium-other-'));

function session(id, { dir = projDir, folder = null, startedAt, title = null, summary = null, todos = [] } = {}) {
  const n = emptyNeutral(id, 'claude');
  n.cwd = dir;
  n.projectDir = dir;
  n.folder = folder;
  n.startedAt = startedAt;
  n.endedAt = startedAt;
  n.turns = [{ role: 'user', text: `work in ${id}` }];
  n.extracted.title = title;
  n.extracted.summary = summary;
  n.extracted.todos = todos;
  saveRaw(n);
  return n;
}

session('old-auth', { folder: 'work/auth', startedAt: '2026-01-01T00:00:00Z' });
session('newer-billing', {
  folder: 'work/billing',
  startedAt: '2026-02-01T00:00:00Z',
  title: 'Fix invoice rounding',
  summary: 'Switched to integer cents.',
  todos: ['Backfill old invoices'],
});
session('newest-archived', { folder: '_archive', startedAt: '2026-03-01T00:00:00Z' });
mkdir('work/billing');
writeFileSync(join(TREE_DIR, 'work', 'billing', 'KNOWLEDGE.md'), 'Money is always integer cents.');
const backlog = emptyNeutral('bl-1', 'mycelium');
backlog.kind = 'backlog';
backlog.folder = 'work/billing';
backlog.extracted.title = 'Add currency column';
backlog.startedAt = '2026-02-02T00:00:00Z';
saveRaw(backlog);
reindex();

test('childEnv() marks LLM subprocesses as Mycelium-internal without dropping the rest of the env', () => {
  const env = childEnv({ PATH: '/bin' });
  assert.equal(env[INTERNAL_ENV], '1');
  assert.equal(env.PATH, '/bin');
});

test('sessionsInDir() finds sessions by their indexed cwd/projectDir, newest first', () => {
  assert.deepEqual(
    sessionsInDir(projDir).map((r) => r.id),
    ['newest-archived', 'newer-billing', 'old-auth'],
  );
  assert.deepEqual(sessionsInDir(otherDir), []);
});

test('folderForDir() picks the most recent filed session, skipping _archive', () => {
  assert.equal(folderForDir(projDir), 'work/billing');
});

test('folderForDir() walks up from a subdirectory, and returns null for an unknown one', () => {
  assert.equal(folderForDir(subDir), 'work/billing');
  assert.equal(folderForDir(otherDir), null);
  assert.equal(folderForDir(null), null);
});

test('folderForDir() prefers a folder pinned with `mycelium link` over the inferred one', () => {
  const cfg = loadConfig();
  saveConfig({ ...cfg, dirFolders: { [projDir]: 'work/auth' } });
  try {
    assert.equal(folderForDir(projDir), 'work/auth');
    assert.equal(folderForDir(subDir), 'work/auth');
  } finally {
    saveConfig(cfg);
  }
});

test('sessionStartContext() briefs a new session with knowledge, the last session here, and backlog', () => {
  const res = sessionStartContext({ cwd: projDir, sessionId: 'current', source: 'startup' }, 'en');
  assert.match(res.additionalContext, /folder: `work\/billing`/);
  assert.match(res.additionalContext, /Money is always integer cents\./);
  assert.match(res.additionalContext, /Fix invoice rounding/);
  assert.match(res.additionalContext, /- Backfill old invoices/);
  assert.match(res.additionalContext, /- Add currency column \(bl-1\)/);
  assert.match(res.systemMessage, /^mycelium · work\/billing · knowledge loaded/);
  assert.match(res.systemMessage, /1 backlog/);
});

test('sessionStartContext() never reports the starting session as its own "last session"', () => {
  const res = sessionStartContext({ cwd: projDir, sessionId: 'newer-billing', source: 'startup' }, 'en');
  assert.doesNotMatch(res.additionalContext, /Fix invoice rounding/);
  assert.match(res.additionalContext, /work in old-auth/);
});

test('sessionStartContext() finds the last session from a subdirectory too', () => {
  const res = sessionStartContext({ cwd: subDir, sessionId: 'current', source: 'startup' }, 'en');
  assert.match(res.additionalContext, /Fix invoice rounding/);
});

test('sessionStartContext() stays silent for an unknown directory and on resume', () => {
  assert.equal(sessionStartContext({ cwd: otherDir, source: 'startup' }, 'en'), null);
  assert.equal(sessionStartContext({ cwd: projDir, source: 'resume' }, 'en'), null);
  assert.equal(sessionStartContext({}, 'en'), null);
});

test('sessionStartContext() follows the content locale', () => {
  const res = sessionStartContext({ cwd: projDir, source: 'compact' }, 'ko');
  assert.match(res.additionalContext, /# Mycelium 컨텍스트/);
  assert.match(res.systemMessage, /지식 로드됨/);
});

test('captureEndedSession() imports exactly the session that ended and indexes it', () => {
  const fake = {
    name: 'claude',
    listSessions: () => [
      { id: 'ended-1', path: '/fake/ended-1.jsonl', mtimeMs: 1 },
      { id: 'other-1', path: '/fake/other-1.jsonl', mtimeMs: 1 },
    ],
    parse: (ref) => {
      const n = emptyNeutral(ref.id, 'claude');
      n.cwd = otherDir;
      n.startedAt = '2026-04-01T00:00:00Z';
      n.turns = [{ role: 'user', text: 'hello' }];
      return n;
    },
  };
  const real = adaptersIndex.ADAPTERS.splice(0, adaptersIndex.ADAPTERS.length, fake);
  try {
    assert.equal(captureEndedSession({ sessionId: 'ended-1' }).status, 'imported');
    assert.ok(loadRaw('ended-1'));
    assert.equal(loadRaw('other-1'), null);
    assert.deepEqual(sessionsInDir(otherDir).map((r) => r.id), ['ended-1']);
    // Unchanged transcript → skipped, same rule as scan().
    assert.equal(captureEndedSession({ sessionId: 'ended-1' }).status, 'skipped');
    assert.equal(captureEndedSession({ sessionId: 'missing' }).status, 'failed');
    assert.equal(captureEndedSession({}).status, 'skipped');
  } finally {
    adaptersIndex.ADAPTERS.splice(0, adaptersIndex.ADAPTERS.length, ...real);
  }
});

test('captureEndedSession() picks the transcript at the hook\'s path when two share an id', () => {
  const fake = {
    name: 'claude',
    listSessions: () => [
      { id: 'dup', path: '/a/dup.jsonl', mtimeMs: 1 },
      { id: 'dup', path: '/b/dup.jsonl', mtimeMs: 1 },
    ],
    parse: (ref) => {
      const n = emptyNeutral(ref.id, 'claude');
      n.turns = [{ role: 'user', text: `from ${ref.path}` }];
      return n;
    },
  };
  const real = adaptersIndex.ADAPTERS.splice(0, adaptersIndex.ADAPTERS.length, fake);
  try {
    captureEndedSession({ sessionId: 'dup', transcriptPath: '/b/dup.jsonl' });
    assert.equal(loadRaw('dup').turns[0].text, 'from /b/dup.jsonl');
  } finally {
    adaptersIndex.ADAPTERS.splice(0, adaptersIndex.ADAPTERS.length, ...real);
  }
});

function runHook(event, input, extraEnv = {}) {
  return execFileSync(process.execPath, [cliPath, 'hook', event], {
    env: { ...process.env, MYCELIUM_HOME: homeDir, ...extraEnv },
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
}

test('`mycelium hook session-start` prints SessionStart JSON for Claude Code', () => {
  const out = JSON.parse(runHook('session-start', { cwd: projDir, session_id: 'x', source: 'startup' }));
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(out.hookSpecificOutput.additionalContext, /Money is always integer cents\./);
  assert.match(out.systemMessage, /work\/billing/);
});

test('`mycelium hook` does nothing inside Mycelium\'s own LLM subprocesses', () => {
  assert.equal(runHook('session-start', { cwd: projDir, source: 'startup' }, { [INTERNAL_ENV]: '1' }), '');
});

test('`mycelium hook` is silent for unknown directories, unknown events and bad input', () => {
  const emptyDir = mkdtempSync(join(tmpdir(), 'mycelium-empty-'));
  assert.equal(runHook('session-start', { cwd: emptyDir, source: 'startup' }), '');
  assert.equal(runHook('bogus', {}), '');
  const out = execFileSync(process.execPath, [cliPath, 'hook', 'session-start'], {
    env: { ...process.env, MYCELIUM_HOME: homeDir },
    input: 'not json',
    encoding: 'utf8',
    cwd: emptyDir,
  });
  assert.equal(out, '');
});

test('`mycelium link` pins, shows, and unpins a directory\'s folder', () => {
  const run = (...args) =>
    execFileSync(process.execPath, [cliPath, 'link', ...args, '--dir', projDir], {
      env: { ...process.env, MYCELIUM_HOME: homeDir },
      encoding: 'utf8',
    });
  assert.match(run(), /work\/billing \(inferred\)/);
  run('work/auth');
  assert.match(run(), /work\/auth \(linked\)/);
  run('--unset');
  assert.match(run(), /work\/billing \(inferred\)/);
  assert.throws(() => run('../escape'));
});
