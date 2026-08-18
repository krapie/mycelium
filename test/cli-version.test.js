import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../src/version.js';

// Spawns the real bin end-to-end (no test seam — this is the one path
// that's genuinely just argv parsing, nothing worth mocking) rather than
// importing cli.js directly, since cli.js calls main() at module scope and
// process.exit() on every branch. execFileSync throws on a non-zero exit
// by design, which is exactly the exit-code assertion this needs — see
// this project's own Homebrew-formula work for why that guarantee matters
// here (mycelium --help was found to silently exit 1, not 0).
//
// MYCELIUM_HOME is still overridden defensively, even though the
// --version branch returns before any store access, so this stays safe
// against a future refactor that moves things around.
const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function runVersionFlag(flag) {
  return execFileSync(process.execPath, [cliPath, flag], {
    env: { ...process.env, MYCELIUM_HOME: '/tmp/mycelium-cli-version-test-unused' },
    encoding: 'utf8',
  }).trim();
}

for (const flag of ['--version', '-v', '-V']) {
  test(`mycelium ${flag} prints the version and exits 0`, () => {
    assert.equal(runVersionFlag(flag), `mycelium v${VERSION}`);
  });
}
