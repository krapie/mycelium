import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const quiet = fileURLToPath(new URL('../src/quiet-warnings.js', import.meta.url));

test('only the node:sqlite ExperimentalWarning is silenced (#147)', () => {
  const script = `import ${JSON.stringify(quiet)}; await import('node:sqlite'); process.emitWarning('still shown', 'DeprecationWarning');`;
  const { stderr } = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.doesNotMatch(stderr, /SQLite is an experimental feature/);
  assert.match(stderr, /DeprecationWarning: still shown/);
});
