import test from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers.js';

useTempHome();

const { emptyNeutral } = await import('../src/schema.js');
const { loadRaw, saveRaw, deleteRaw, allRaw, findSession, purgeMeta, scan, reevaluateArchive } = await import('../src/scanner.js');
const { META_MARKER } = await import('../src/llm.js');
const adaptersIndex = await import('../src/adapters/index.js');

// scan() iterates the real ADAPTERS array, and the real claude/codex/kiro
// adapters read from the actual ~/.claude, ~/.codex, ~/.kiro on this machine
// regardless of MYCELIUM_HOME (only the neutral session it WRITES lands under
// the isolated temp home). To test scan() deterministically — without also
// re-importing this machine's real sessions and blowing up the expected
// counts below — temporarily swap the array's contents down to just the fake
// adapter(s) under test, then restore the real ones.
function withOnlyAdapters(fakeAdapters, fn) {
  const real = adaptersIndex.ADAPTERS.splice(0, adaptersIndex.ADAPTERS.length, ...fakeAdapters);
  try {
    return fn();
  } finally {
    adaptersIndex.ADAPTERS.splice(0, adaptersIndex.ADAPTERS.length, ...real);
  }
}

test('saveRaw()/loadRaw() round-trip a session by id', () => {
  const n = emptyNeutral('sess-1', 'claude');
  n.extracted.title = 'hello';
  saveRaw(n);
  const loaded = loadRaw('sess-1');
  assert.equal(loaded.id, 'sess-1');
  assert.equal(loaded.extracted.title, 'hello');
});

test('loadRaw() returns null for a session that was never saved', () => {
  assert.equal(loadRaw('does-not-exist'), null);
});

test('deleteRaw() removes the file; loadRaw() then returns null', () => {
  saveRaw(emptyNeutral('sess-del', 'claude'));
  assert.ok(loadRaw('sess-del'));
  deleteRaw('sess-del');
  assert.equal(loadRaw('sess-del'), null);
});

test('deleteRaw() on a nonexistent id is a harmless no-op', () => {
  assert.doesNotThrow(() => deleteRaw('never-existed'));
});

test('allRaw() lists every saved session and skips corrupt raw files', async () => {
  const before = allRaw().length;
  saveRaw(emptyNeutral('sess-a', 'claude'));
  saveRaw(emptyNeutral('sess-b', 'codex'));
  const { RAW_DIR } = await import('../src/paths.js');
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  writeFileSync(join(RAW_DIR, 'corrupt.json'), '{ not json');
  const all = allRaw();
  assert.equal(all.length, before + 2);
  assert.ok(all.some((n) => n.id === 'sess-a'));
  assert.ok(all.some((n) => n.id === 'sess-b'));
});

test('findSession() resolves an exact id', () => {
  saveRaw(emptyNeutral('exact-id-123', 'claude'));
  const res = findSession('exact-id-123');
  assert.equal(res.ok, true);
  assert.equal(res.session.id, 'exact-id-123');
});

test('findSession() resolves a unique prefix', () => {
  saveRaw(emptyNeutral('prefix-unique-abc', 'claude'));
  const res = findSession('prefix-uniq');
  assert.equal(res.ok, true);
  assert.equal(res.session.id, 'prefix-unique-abc');
});

test('findSession() reports no match', () => {
  const res = findSession('totally-nonexistent-prefix');
  assert.equal(res.ok, false);
  assert.match(res.error, /no session matching/);
});

test('findSession() reports ambiguous prefix with up to 5 hints', () => {
  saveRaw(emptyNeutral('dup-aaa1', 'claude'));
  saveRaw(emptyNeutral('dup-aaa2', 'claude'));
  const res = findSession('dup-aaa');
  assert.equal(res.ok, false);
  assert.match(res.error, /ambiguous prefix/);
  assert.match(res.error, /2 matches/);
});

test('purgeMeta() removes sessions whose first user turn carries META_MARKER', () => {
  const meta = emptyNeutral('meta-1', 'claude');
  meta.turns = [{ role: 'user', text: `${META_MARKER}\nsummarize this` }];
  saveRaw(meta);
  const real = emptyNeutral('real-1', 'claude');
  real.turns = [{ role: 'user', text: 'please fix the bug' }];
  saveRaw(real);

  const removed = purgeMeta();

  assert.equal(removed, 1);
  assert.equal(loadRaw('meta-1'), null);
  assert.ok(loadRaw('real-1'));
});

test('scan() imports from a fake adapter and carries forward downstream-owned fields on re-import', () => {
  const fakeRef = { id: 'fake-session-1', mtimeMs: 1000 };
  const fakeAdapter = {
    name: 'fake-source',
    listSessions: () => [fakeRef],
    parse: (ref) => {
      const n = emptyNeutral(ref.id, 'fake-source');
      n.turns = [{ role: 'user', text: 'do the thing' }];
      return n;
    },
  };
  withOnlyAdapters([fakeAdapter], () => {
    const res1 = scan();
    assert.equal(res1.imported, 1);
    assert.equal(res1.scanned, 1);

    // Simulate downstream lifecycle stages owning fields on the imported session.
    const imported = loadRaw('fake-session-1');
    imported.extracted.title = 'Human title';
    imported.folder = 'work/stuff';
    imported.organizedBy = 'human';
    imported.titleLocked = true;
    imported.mergedFrom = ['other-id'];
    saveRaw(imported);

    // Second scan: same mtimeMs -> normally skipped entirely, so bump mtimeMs
    // to force a re-parse and exercise the carry-forward logic.
    fakeRef.mtimeMs = 2000;
    const res2 = scan();
    assert.equal(res2.imported, 1);

    const reimported = loadRaw('fake-session-1');
    assert.equal(reimported.extracted.title, 'Human title');
    assert.equal(reimported.folder, 'work/stuff');
    assert.equal(reimported.organizedBy, 'human');
    assert.equal(reimported.titleLocked, true);
    assert.deepEqual(reimported.mergedFrom, ['other-id']);
  });
});

test('scan() skips unchanged sessions on a second pass (same mtimeMs)', () => {
  const fakeRef = { id: 'fake-session-2', mtimeMs: 500 };
  const fakeAdapter = {
    name: 'fake-source-2',
    listSessions: () => [fakeRef],
    parse: (ref) => {
      const n = emptyNeutral(ref.id, 'fake-source-2');
      n.turns = [{ role: 'user', text: 'hello there' }];
      return n;
    },
  };
  withOnlyAdapters([fakeAdapter], () => {
    scan();
    const res2 = scan();
    assert.equal(res2.imported, 0);
    assert.equal(res2.skipped, 1);
  });
});

test('scan() skips every adapter (real or fake) when MYCELIUM_DEMO_MODE=1, so mycelium demo never pulls real session content into its throwaway store', () => {
  const fakeRef = { id: 'demo-mode-should-skip-this', mtimeMs: 1000 };
  const fakeAdapter = {
    name: 'fake-source-demo-mode',
    listSessions: () => [fakeRef],
    parse: (ref) => {
      const n = emptyNeutral(ref.id, 'fake-source-demo-mode');
      n.turns = [{ role: 'user', text: 'this should never actually get imported' }];
      return n;
    },
  };
  withOnlyAdapters([fakeAdapter], () => {
    process.env.MYCELIUM_DEMO_MODE = '1';
    try {
      const res = scan();
      assert.equal(res.scanned, 0, 'adapter never even asked for its sessions');
      assert.equal(res.imported, 0);
      assert.equal(loadRaw('demo-mode-should-skip-this'), null);
    } finally {
      delete process.env.MYCELIUM_DEMO_MODE;
    }

    // Sanity check the flag is actually what's gating this, not something
    // else — same adapter, same session, imports normally once it's unset.
    const res2 = scan();
    assert.equal(res2.imported, 1);
  });
});

test('scan() drops sessions with zero turns as skipped, not imported', () => {
  const fakeRef = { id: 'empty-session', mtimeMs: 1 };
  const fakeAdapter = {
    name: 'fake-source-3',
    listSessions: () => [fakeRef],
    parse: (ref) => emptyNeutral(ref.id, 'fake-source-3'),
  };
  withOnlyAdapters([fakeAdapter], () => {
    const res = scan();
    assert.equal(res.imported, 0);
    assert.equal(res.skipped, 1);
    assert.equal(loadRaw('empty-session'), null);
  });
});

const daysAgoIso = (n) => new Date(Date.now() - n * 86400000).toISOString();

test('scan() files an old session straight into _archive on first capture (recency-based)', () => {
  const fakeRef = { id: 'old-session', mtimeMs: 10 };
  const fakeAdapter = {
    name: 'fake-old',
    listSessions: () => [fakeRef],
    parse: (ref) => {
      const n = emptyNeutral(ref.id, 'fake-old');
      n.turns = [{ role: 'user', text: 'ancient work' }];
      n.endedAt = daysAgoIso(120); // well past the 30-day default
      return n;
    },
  };
  withOnlyAdapters([fakeAdapter], () => {
    const res = scan();
    assert.equal(res.imported, 1);
    const n = loadRaw('old-session');
    assert.equal(n.folder, '_archive');
    assert.equal(n.organizedBy, 'auto'); // not lied to as human
  });
});

test('scan() leaves a recent session unfiled (New), not archived', () => {
  const fakeRef = { id: 'recent-session', mtimeMs: 11 };
  const fakeAdapter = {
    name: 'fake-recent',
    listSessions: () => [fakeRef],
    parse: (ref) => {
      const n = emptyNeutral(ref.id, 'fake-recent');
      n.turns = [{ role: 'user', text: 'fresh work' }];
      n.endedAt = daysAgoIso(2);
      return n;
    },
  };
  withOnlyAdapters([fakeAdapter], () => {
    scan();
    assert.equal(loadRaw('recent-session').folder, null);
  });
});

test('scan() never retroactively archives an already-stored unfiled session (first-import only)', () => {
  // Pre-seed a session as if captured earlier while it was recent, now grown
  // old — a plain re-scan (bumped mtime) must NOT sweep it into _archive.
  const existing = emptyNeutral('grown-old', 'fake-grow');
  existing.turns = [{ role: 'user', text: 'started recent' }];
  existing.endedAt = daysAgoIso(200);
  existing.folder = null;
  existing._mtimeMs = 100;
  saveRaw(existing);

  const fakeRef = { id: 'grown-old', mtimeMs: 999 }; // changed -> forces re-parse
  const fakeAdapter = {
    name: 'fake-grow',
    listSessions: () => [fakeRef],
    parse: (ref) => {
      const n = emptyNeutral(ref.id, 'fake-grow');
      n.turns = [{ role: 'user', text: 'started recent' }];
      n.endedAt = daysAgoIso(200);
      return n;
    },
  };
  withOnlyAdapters([fakeAdapter], () => {
    scan();
    assert.equal(loadRaw('grown-old').folder, null); // still New, untouched
  });
});

test('reevaluateArchive() brings an auto-archived session back to New when it is inside a widened window', () => {
  const n = emptyNeutral('reeval-back', 'claude');
  n.folder = '_archive';
  n.organizedBy = 'auto';
  n.endedAt = daysAgoIso(60); // archived under 30d, but inside a 90d window
  saveRaw(n);

  const res = reevaluateArchive({ days: 90 });

  assert.equal(loadRaw('reeval-back').folder, null);
  assert.ok(res.unarchived >= 1);
});

test('reevaluateArchive() never disturbs a human placement or a real-folder session', () => {
  const human = emptyNeutral('reeval-human', 'claude');
  human.folder = '_archive';
  human.organizedBy = 'human'; // deliberately archived by a person
  human.endedAt = daysAgoIso(5);
  saveRaw(human);

  const filed = emptyNeutral('reeval-filed', 'claude');
  filed.folder = 'work/proj';
  filed.organizedBy = 'auto';
  filed.endedAt = daysAgoIso(400); // old, but sits in a real folder
  saveRaw(filed);

  reevaluateArchive({ days: 90 });

  assert.equal(loadRaw('reeval-human').folder, '_archive'); // human archive kept
  assert.equal(loadRaw('reeval-filed').folder, 'work/proj'); // real folder kept
});

test('reevaluateArchive({days:0}) un-archives everything auto (threshold disabled)', () => {
  const n = emptyNeutral('reeval-disable', 'claude');
  n.folder = '_archive';
  n.organizedBy = 'auto';
  n.endedAt = daysAgoIso(1000);
  saveRaw(n);

  reevaluateArchive({ days: 0 });

  assert.equal(loadRaw('reeval-disable').folder, null);
});
