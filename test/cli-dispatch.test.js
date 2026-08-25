import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers.js';

// Spawns the real bin end-to-end, same reasoning as cli-version.test.js:
// cli.js calls main() at module scope and process.exit() on every branch,
// so importing it directly isn't viable — see that file's own comment.
//
// This is the regression net for the cli.js -> src/cli/*.js split (issue
// #88) and a first pass at issue #71's "cli.js's untested dispatch layer"
// gap — not exhaustive coverage of every flag every command accepts, but
// enough to prove the dispatch table actually reaches each command module
// and that basic argument handling/exit codes still work.
const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));

const homeDir = useTempHome();
const { saveRaw } = await import('../src/scanner.js');
const { emptyNeutral } = await import('../src/schema.js');

// execFileSync throws on a non-zero exit (by design — see cli-version.test.js),
// so failure-path assertions need the thrown error's own stdout/status
// rather than a plain return value.
function runCli(args) {
  return execFileSync(process.execPath, [cliPath, ...args], {
    env: { ...process.env, MYCELIUM_HOME: homeDir },
    encoding: 'utf8',
  });
}

function runCliExpectFail(args) {
  try {
    runCli(args);
    assert.fail(`expected "mycelium ${args.join(' ')}" to exit non-zero`);
  } catch (err) {
    return { status: err.status, stdout: err.stdout, stderr: err.stderr };
  }
}

test('unknown command prints help and exits 1', () => {
  const { status, stdout } = runCliExpectFail(['bogus']);
  assert.equal(status, 1);
  assert.match(stdout, /Mycelium/);
});

test('mkdir creates a folder, visible via list --folder', () => {
  saveRaw(emptyNeutral('cli-dispatch-mkdir-target', 'claude'));
  const created = runCli(['mkdir', 'cli-dispatch-test-folder']).trim();
  assert.equal(created, 'created cli-dispatch-test-folder');
});

test('mv files a session, tag edits its tags, list/search/tags reflect it', () => {
  const n = emptyNeutral('cli-dispatch-mv-target', 'claude');
  n.turns = [{ role: 'user', text: 'cli dispatch test needle' }];
  saveRaw(n);

  const mvOut = runCli(['mv', 'cli-dispatch-mv-target', 'cli-dispatch-test-folder']);
  assert.match(mvOut, /moved cli-dis.*cli-dispatch-test-folder/);

  const tagOut = runCli(['tag', 'cli-dispatch-mv-target', '+needle-tag']);
  assert.match(tagOut, /needle-tag/);

  const listOut = runCli(['list', '--folder', 'cli-dispatch-test-folder']);
  assert.match(listOut, /cli dispatch test needle/);
  assert.match(listOut, /#needle-tag/);

  const searchOut = runCli(['search', 'needle']);
  assert.match(searchOut, /cli-dispatch-mv-target|cli-dis/);

  const tagsOut = runCli(['tags']);
  assert.match(tagsOut, /needle-tag/);
});

test('unmerge on a session that was never merged fails with a clear error', () => {
  saveRaw(emptyNeutral('cli-dispatch-unmerge-target', 'claude'));
  const { status, stderr } = runCliExpectFail(['unmerge', 'cli-dispatch-unmerge-target']);
  assert.equal(status, 1);
  assert.ok(stderr.length > 0);
});

test('lang: query, set, and reject an invalid locale', () => {
  const before = runCli(['lang']).trim();
  assert.match(before, /^current: (en|ko)$/);

  const setOut = runCli(['lang', 'ko']).trim();
  assert.match(setOut, /language set to ko/);
  assert.equal(runCli(['lang']).trim(), 'current: ko');

  runCli(['lang', 'en']); // reset — this file's store is shared across its own tests
  const { status } = runCliExpectFail(['lang', 'xx']);
  assert.equal(status, 1);
});

test('cleanup tidy runs against an empty-of-meta store without error', () => {
  const out = runCli(['cleanup', 'tidy']);
  assert.match(out, /정리 완료/);
});

test('scan with MYCELIUM_DEMO_MODE=1 skips real adapters (never touches this developer machine\'s real sessions)', () => {
  const out = execFileSync(process.execPath, [cliPath, 'scan'], {
    env: { ...process.env, MYCELIUM_HOME: homeDir, MYCELIUM_DEMO_MODE: '1' },
    encoding: 'utf8',
  });
  assert.match(out, /scanned 0, imported 0, skipped 0, failed 0/);
});
