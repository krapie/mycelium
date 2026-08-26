import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { useTempHome } from './helpers.js';

// cli.js's own dispatch/argument-parsing (the actual entry point run on
// every invocation) had zero automated coverage — every subcommand's real
// logic is already well-tested at the module level (scanner/organize/learn/
// insight/index-db), but the glue connecting argv to those modules wasn't.
// See issue #71.
//
// Spawned as a REAL subprocess (not imported in-process) because cli.js
// calls process.exit() throughout — the standard way to test a CLI built
// that way without refactoring it. The one real limitation this brings:
// __setTestProvider() (src/llm.js) is an in-process-only seam and does not
// cross a spawned subprocess boundary, so LLM-dependent branches (autotag's
// actual tagging call, organize's actual classification call, digest,
// knowledge's actual extraction call) are NOT covered here — only their
// argument-validation and empty-store early-exit paths are, since those
// return before ever calling complete(). The LLM-invoking branches
// themselves are covered at the module level instead (learn.test.js,
// organize.test.js, insight.test.js, via the mock provider).
const home = useTempHome();

const { emptyNeutral } = await import('../src/schema.js');
const { saveRaw, loadRaw } = await import('../src/scanner.js');
const { reindex } = await import('../src/index-db.js');
const { queueSuggestions, clearSuggestions } = await import('../src/organize.js');
const { loadConfig } = await import('../src/config.js');
const { VERSION } = await import('../src/version.js');
const { __clearTestProvider } = await import('../src/llm.js');

// This file never calls __setTestProvider() — every subcommand tested here
// is spawned as a real subprocess (see the header comment above), and that
// seam is in-process only, so there's nothing for it to actually clean up
// today. Still following AGENTS.md's "always __clearTestProvider() in
// afterEach" convention defensively, in case a future edit to this file
// ever does call it in-process.
test.afterEach(() => __clearTestProvider());

const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');

function runCli(args, { home: overrideHome } = {}) {
  const res = spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: 'utf8',
    env: { ...process.env, MYCELIUM_HOME: overrideHome ?? home },
  });
  return { stdout: res.stdout ?? '', stderr: res.stderr ?? '', status: res.status };
}

function seed(id, overrides = {}) {
  const n = { ...emptyNeutral(id, 'claude'), ...overrides };
  saveRaw(n);
  return n;
}

// --- Other: --version --------------------------------------------------

test('--version / -v / -V all print the version and exit 0', () => {
  for (const flag of ['--version', '-v', '-V']) {
    const { stdout, status } = runCli([flag]);
    assert.equal(status, 0);
    assert.equal(stdout.trim(), `mycelium v${VERSION}`);
  }
});

// --- Capture: scan, reindex, archive ------------------------------------

test('reindex prints a count and exits 0, even on an empty store', () => {
  const { stdout, status } = runCli(['reindex']);
  assert.equal(status, 0);
  assert.match(stdout, /^reindexed \d+ sessions/);
});

test('scan runs end to end and exits 0 (counts vary by machine, so only the shape is asserted)', () => {
  // Its own dedicated store, not the shared `home` — scan() reads from the
  // real ~/.claude/~/.codex/~/.kiro by design (see AGENTS.md's adapter
  // testing note), so running it against the shared home would import
  // whatever real, personal sessions happen to exist on the machine running
  // this test and pollute every other test in this file that lists/
  // searches the store. Confirmed the hard way — see PR history for #71.
  const scanHome = mkdtempSync(join(tmpdir(), 'mycelium-test-cli-scan-'));
  const { stdout, status } = runCli(['scan'], { home: scanHome });
  assert.equal(status, 0);
  assert.match(stdout, /scanned \d+, imported \d+, skipped \d+, failed \d+/);
  assert.match(stdout, /reindexed \d+ sessions/);
});

test('archive reeval works with no --days (reuses whatever is already configured)', () => {
  const { stdout, status } = runCli(['archive', 'reeval']);
  assert.equal(status, 0);
  assert.match(stdout, /재평가 완료/);
});

test('archive reeval --days persists the new threshold', () => {
  const { status } = runCli(['archive', 'reeval', '--days', '30']);
  assert.equal(status, 0);
  assert.equal(loadConfig().archiveOlderThanDays, 30);
});

test('archive reeval --days rejects a non-numeric value', () => {
  const { stderr, status } = runCli(['archive', 'reeval', '--days', 'soon']);
  assert.equal(status, 1);
  assert.match(stderr, /숫자여야 합니다/);
});

test('archive with an unknown sub-target fails with usage', () => {
  const { stderr, status } = runCli(['archive', 'bogus']);
  assert.equal(status, 1);
  assert.match(stderr, /알 수 없는 대상/);
});

// --- Organize: mkdir, mv, tag, unmerge/unsplit usage --------------------

test('mkdir creates a folder and prints its path', () => {
  const { stdout, status } = runCli(['mkdir', 'cli-test/created']);
  assert.equal(status, 0);
  assert.match(stdout, /created .*cli-test[/\\]created/);
});

test('mkdir with no argument fails with usage', () => {
  const { stderr, status } = runCli(['mkdir']);
  assert.equal(status, 1);
  assert.match(stderr, /Usage: mycelium mkdir/);
});

test('mv moves a session and marks it human-organized', () => {
  seed('cli-mv-1', { folder: null });
  const { stdout, status } = runCli(['mv', 'cli-mv-1', 'cli-test/moved']);
  assert.equal(status, 0);
  assert.match(stdout, /moved cli-mv-1.*cli-test\/moved \(human\)/);
  assert.equal(loadRaw('cli-mv-1').organizedBy, 'human');
});

test('mv with a missing sessionId fails with usage', () => {
  const { stderr, status } = runCli(['mv']);
  assert.equal(status, 1);
  assert.match(stderr, /Usage: mycelium mv/);
});

test('mv on a nonexistent session reports the underlying error', () => {
  const { stderr, status } = runCli(['mv', 'does-not-exist', 'somewhere']);
  assert.equal(status, 1);
  assert.match(stderr, /does-not-exist/);
});

test('tag adds and removes tags, and reindex()es afterward', () => {
  seed('tagid001', { extracted: { title: null, tags: ['keep'], summary: null, decisions: [], todos: [] } });
  const { stdout, status } = runCli(['tag', 'tagid001', '+added', '-keep']);
  assert.equal(status, 0);
  assert.match(stdout, /tagid001 tags: added \(human\)/);
});

test('tag with a missing sessionId fails with usage', () => {
  const { stderr, status } = runCli(['tag']);
  assert.equal(status, 1);
  assert.match(stderr, /Usage: mycelium tag/);
});

test('unmerge with a missing id fails with usage', () => {
  const { stderr, status } = runCli(['unmerge']);
  assert.equal(status, 1);
  assert.match(stderr, /Usage: mycelium unmerge/);
});

test('unmerge on a nonexistent session reports "no session matching"', () => {
  const { stderr, status } = runCli(['unmerge', 'nope']);
  assert.equal(status, 1);
  assert.match(stderr, /no session matching/);
});

test('unsplit with a missing id fails with usage', () => {
  const { stderr, status } = runCli(['unsplit']);
  assert.equal(status, 1);
  assert.match(stderr, /Usage: mycelium unsplit/);
});

test('organize with a pre-queued suggestion skips the LLM entirely and just prints it', () => {
  seed('orgid001', { folder: null });
  queueSuggestions([{ id: 'orgid001', folder: 'cli-test/suggested', reason: 'matches an existing pattern' }]);
  const { stdout, status } = runCli(['organize']);
  assert.equal(status, 0);
  assert.match(stdout, /orgid001.*→ cli-test\/suggested \(new folder\).*matches an existing pattern/);
  assert.match(stdout, /1 suggested — re-run with --apply to file them/);
  // Without --apply this stays queued — clear it so it doesn't leak into
  // the next test's own `organize --apply` (which would otherwise apply
  // this one too, since pendingSuggestions() with no --folder returns
  // everything still queued across the whole store).
  clearSuggestions(['orgid001']);
});

test('organize --apply actually applies the pre-queued suggestion', () => {
  seed('orgid002', { folder: null });
  queueSuggestions([{ id: 'orgid002', folder: 'cli-test/applied', reason: 'r' }]);
  const { stdout, status } = runCli(['organize', '--apply']);
  assert.equal(status, 0);
  assert.match(stdout, /applied 1 placements/);
  assert.equal(loadRaw('orgid002').folder, 'cli-test/applied');
});

// --- Learn: autotag/digest/knowledge — only the LLM-free paths ----------

test('autotag with no sessionId and nothing to tag reports zeros without calling the LLM', () => {
  // A dedicated empty store: the shared `home` above has seeded sessions by
  // this point in the file, and any of them lacking a summary would make
  // tagAll() actually try to call the LLM (hanging/failing in CI, since
  // there's no real claude/codex CLI to answer it).
  const emptyHome = mkdtempSync(join(tmpdir(), 'mycelium-test-cli-empty-'));
  const { stdout, status } = runCli(['autotag'], { home: emptyHome });
  assert.equal(status, 0);
  assert.match(stdout, /tagged 0, skipped 0, failed 0/);
});

test('digest fails cleanly (not an LLM call) when there are no sessions for the day', () => {
  const emptyHome = mkdtempSync(join(tmpdir(), 'mycelium-test-cli-empty-'));
  const { stderr, status } = runCli(['digest', '--date', '2020-01-01'], { home: emptyHome });
  assert.equal(status, 1);
  assert.match(stderr, /no sessions for 2020-01-01/);
});

test('knowledge on a folder with no sessions fails cleanly (not an LLM call)', () => {
  const { stderr, status } = runCli(['knowledge', 'cli-test/nonexistent-folder']);
  assert.equal(status, 1);
  assert.match(stderr, /no sessions in cli-test\/nonexistent-folder/);
});

// --- Reuse: context, inject, handoff, resume ----------------------------

test('context for a session with nothing inherited says so', () => {
  seed('cli-ctx-1', { folder: null });
  const { stdout, status } = runCli(['context', 'cli-ctx-1']);
  assert.equal(status, 0);
  assert.match(stdout, /상속할 컨텍스트 없음/);
});

test('context with neither a sessionId nor --folder fails with usage', () => {
  const { stderr, status } = runCli(['context']);
  assert.equal(status, 1);
  assert.match(stderr, /Usage: mycelium context/);
});

test('inject without --folder fails (can\'t infer a target folder)', () => {
  const { stderr, status } = runCli(['inject']);
  assert.equal(status, 1);
  assert.match(stderr, /대상 폴더를 결정할 수 없습니다/);
});

test('handoff builds a real prompt from an existing session', () => {
  seed('hoid0001', {
    turns: [{ role: 'user', text: 'Please refactor the auth middleware', timestamp: null }],
  });
  const { stdout, status } = runCli(['handoff', 'hoid0001']);
  assert.equal(status, 0);
  assert.match(stdout, /hoid0001/);
  assert.match(stdout, /refactor the auth middleware/);
});

test('handoff with a missing sessionId fails with usage', () => {
  const { stderr, status } = runCli(['handoff']);
  assert.equal(status, 1);
  assert.match(stderr, /Usage: mycelium handoff/);
});

test('handoff on a nonexistent session reports the underlying error', () => {
  const { stderr, status } = runCli(['handoff', 'does-not-exist']);
  assert.equal(status, 1);
  assert.match(stderr, /does-not-exist/);
});

test('resume with no argument fails with usage', () => {
  const { stderr, status } = runCli(['resume']);
  assert.equal(status, 1);
  assert.match(stderr, /Usage: mycelium resume/);
});

test('resume on a nonexistent session reports "no session matching"', () => {
  const { stderr, status } = runCli(['resume', 'nope']);
  assert.equal(status, 1);
  assert.match(stderr, /no session matching/);
});

test('resume on a merged session redirects to handoff instead', () => {
  seed('cli-resume-merged', { mergedFrom: ['a', 'b'] });
  const { stderr, status } = runCli(['resume', 'cli-resume-merged']);
  assert.equal(status, 1);
  assert.match(stderr, /not resumable.*mycelium handoff cli-resume-merged/s);
});

// --- Find: search, tags, list -------------------------------------------

test('search finds a seeded session by content and reports a result count', () => {
  seed('srchid01', {
    turns: [{ role: 'user', text: 'unique-search-marker-xyz please help', timestamp: null }],
  });
  reindex();
  const { stdout, status } = runCli(['search', 'unique-search-marker-xyz']);
  assert.equal(status, 0);
  assert.match(stdout, /srchid01/);
  assert.match(stdout, /1 results/);
});

test('tags lists tag counts from the index', () => {
  seed('cli-tags-1', { extracted: { title: null, tags: ['cli-unique-tag'], summary: null, decisions: [], todos: [] } });
  reindex();
  const { stdout, status } = runCli(['tags']);
  assert.equal(status, 0);
  assert.match(stdout, /cli-unique-tag/);
});

test('list hides _archive by default but shows it with --folder _archive', () => {
  seed('lstarch1', { folder: '_archive' });
  const withoutArchive = runCli(['list']);
  assert.equal(withoutArchive.status, 0);
  assert.doesNotMatch(withoutArchive.stdout, /lstarch1/);

  const withArchive = runCli(['list', '--folder', '_archive']);
  assert.equal(withArchive.status, 0);
  assert.match(withArchive.stdout, /lstarch1/);
});

// --- Run: lang, daemon --stop --------------------------------------------

test('lang with no argument prints the current locale', () => {
  const { stdout, status } = runCli(['lang']);
  assert.equal(status, 0);
  assert.match(stdout, /^current: (en|ko)/);
});

test('lang <en|ko> sets and persists the locale', () => {
  try {
    const { stdout, status } = runCli(['lang', 'ko']);
    assert.equal(status, 0);
    assert.match(stdout, /language set to ko/);
    assert.equal(loadConfig().locale, 'ko');
  } finally {
    // Reset for any later test relying on the default — in a finally so a
    // failed assertion above can't leave 'ko' leaking into them too.
    runCli(['lang', 'en']);
  }
});

test('lang with an invalid locale fails with usage', () => {
  const { stderr, status } = runCli(['lang', 'fr']);
  assert.equal(status, 1);
  assert.match(stderr, /Usage: mycelium lang/);
});

test('daemon --stop when nothing is running says so (does not spawn anything)', () => {
  const { stdout, status } = runCli(['daemon', '--stop']);
  assert.equal(status, 0);
  assert.match(stdout, /daemon is not running/);
});

// --- Clean: cleanup ------------------------------------------------------

test('cleanup (default tidy) runs end to end', () => {
  const { stdout, status } = runCli(['cleanup']);
  assert.equal(status, 0);
  assert.match(stdout, /정리 완료/);
});

test('cleanup folders/archive/index all run without error', () => {
  for (const sub of ['folders', 'archive', 'index']) {
    const { status } = runCli(['cleanup', sub]);
    assert.equal(status, 0, `cleanup ${sub} should exit 0`);
  }
});

test('cleanup with an unknown target fails with usage', () => {
  const { stderr, status } = runCli(['cleanup', 'bogus']);
  assert.equal(status, 1);
  assert.match(stderr, /알 수 없는 대상/);
});

test('cleanup reset without --yes refuses (does not touch the store)', () => {
  const { stderr, status } = runCli(['cleanup', 'reset']);
  assert.equal(status, 1);
  assert.match(stderr, /mycelium cleanup reset --yes/);
});

test('cleanup reset --yes actually wipes the store', () => {
  // Its own dedicated store — this is genuinely destructive, and must not
  // touch the shared `home` every other test in this file still uses.
  // `mkdir` (rather than `scan`, which would hit the real ~/.claude etc.)
  // is the deterministic way to put something on disk under a fresh home.
  const throwawayHome = mkdtempSync(join(tmpdir(), 'mycelium-test-cli-reset-'));
  const created = runCli(['mkdir', 'to-be-wiped'], { home: throwawayHome });
  assert.equal(created.status, 0);
  const folderPath = join(throwawayHome, 'tree', 'to-be-wiped');
  assert.ok(existsSync(folderPath));

  const { stdout, status } = runCli(['cleanup', 'reset', '--yes'], { home: throwawayHome });
  assert.equal(status, 0);
  assert.match(stdout, /전체 초기화 완료/);
  assert.ok(!existsSync(folderPath));
});

// --- Other: unknown command -----------------------------------------------

test('an unrecognized command prints the full help text and exits 1', () => {
  const { stdout, status } = runCli(['this-is-not-a-command']);
  assert.equal(status, 1);
  assert.match(stdout, /Mycelium —/);
  assert.match(stdout, /Capture\s+scan/);
});
