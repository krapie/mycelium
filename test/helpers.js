import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Call at the very top of a test file — before any other import — for any
 * test that touches src/paths.js (directly or transitively, e.g. scanner.js/
 * cleanup.js/organize.js). paths.js reads MYCELIUM_HOME exactly once, at
 * module load time, so this only works because `node --test` runs each test
 * FILE in its own process: setting the env var here, then reaching every
 * other module via a dynamic `await import()` (never a static top-level
 * import, which is hoisted and would run before this had a chance to set
 * the variable), guarantees paths.js sees this test's own isolated
 * directory instead of the developer's real ~/.mycelium.
 */
export function useTempHome() {
  const dir = mkdtempSync(join(tmpdir(), 'mycelium-test-'));
  process.env.MYCELIUM_HOME = dir;
  return dir;
}
