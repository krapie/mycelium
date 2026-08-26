import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newCommandLine } from '../src/agents.js';

// which() reads real process.env.PATH — no MYCELIUM_HOME dependency, so no
// useTempHome()/dynamic-import dance needed here (see AGENTS.md's Tests
// section for when that IS required).

test("newCommandLine() fails with '<bin> not installed' when the real binary isn't on PATH", () => {
  const prevPath = process.env.PATH;
  const prevDemoMode = process.env.MYCELIUM_DEMO_MODE;
  process.env.PATH = ''; // guarantees `claude` isn't found
  delete process.env.MYCELIUM_DEMO_MODE;
  try {
    const dir = mkdtempSync(join(tmpdir(), 'mycelium-agents-'));
    const res = newCommandLine({ agentKey: 'claude', dir, seed: undefined });
    assert.equal(res.ok, false);
    assert.match(res.error, /claude not installed/);
  } finally {
    process.env.PATH = prevPath;
    if (prevDemoMode === undefined) delete process.env.MYCELIUM_DEMO_MODE;
    else process.env.MYCELIUM_DEMO_MODE = prevDemoMode;
  }
});

test('newCommandLine() skips the real which() check when MYCELIUM_DEMO_MODE=1, even with no real binary on PATH', () => {
  // The tutorial's `n` step (copyOnly) relies on this — CI/most
  // contributors' machines have no agent CLI installed at all, which would
  // otherwise make the tutorial's copy step fail with "claude not
  // installed" instead of the intended "copied to clipboard" result.
  const prevPath = process.env.PATH;
  const prevDemoMode = process.env.MYCELIUM_DEMO_MODE;
  process.env.PATH = '';
  process.env.MYCELIUM_DEMO_MODE = '1';
  try {
    const dir = mkdtempSync(join(tmpdir(), 'mycelium-agents-'));
    const res = newCommandLine({ agentKey: 'claude', dir, seed: undefined });
    assert.equal(res.ok, true);
    assert.match(res.line, /claude/);
    assert.equal(res.cwd, dir);
  } finally {
    process.env.PATH = prevPath;
    if (prevDemoMode === undefined) delete process.env.MYCELIUM_DEMO_MODE;
    else process.env.MYCELIUM_DEMO_MODE = prevDemoMode;
  }
});

test('newCommandLine() still fails for an unknown agent key or a missing directory, regardless of MYCELIUM_DEMO_MODE', () => {
  const prevDemoMode = process.env.MYCELIUM_DEMO_MODE;
  process.env.MYCELIUM_DEMO_MODE = '1';
  try {
    const dir = mkdtempSync(join(tmpdir(), 'mycelium-agents-'));
    assert.equal(newCommandLine({ agentKey: 'not-a-real-agent', dir }).ok, false);
    assert.equal(newCommandLine({ agentKey: 'claude', dir: '/no/such/dir/at/all' }).ok, false);
  } finally {
    if (prevDemoMode === undefined) delete process.env.MYCELIUM_DEMO_MODE;
    else process.env.MYCELIUM_DEMO_MODE = prevDemoMode;
  }
});
