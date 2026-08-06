import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers.js';

useTempHome();

// Dynamic imports — see helpers.js's useTempHome() doc comment for why these
// can't be static top-level imports here.
const { emptyNeutral } = await import('../src/schema.js');
const { saveRaw } = await import('../src/scanner.js');
const { mkdir } = await import('../src/organize.js');
const { pruneEmptyFolders, clearArchive, rebuildIndex, tidy, resetStore } = await import('../src/cleanup.js');
const { TREE_DIR, HOME, RAW_DIR } = await import('../src/paths.js');
const { loadRaw } = await import('../src/scanner.js');
const { listSessions } = await import('../src/index-db.js');
const { META_MARKER } = await import('../src/llm.js');

test('pruneEmptyFolders() removes folders with no sessions but keeps folders that have one', () => {
  mkdir('backend/empty-folder');
  mkdir('backend/used-folder');
  const used = emptyNeutral('used-1', 'claude');
  used.folder = 'backend/used-folder';
  saveRaw(used);

  const removed = pruneEmptyFolders();

  assert.equal(removed, 1);
  assert.equal(existsSync(join(TREE_DIR, 'backend', 'empty-folder')), false);
  assert.equal(existsSync(join(TREE_DIR, 'backend', 'used-folder')), true);
  // Ancestor of a used folder must survive even though no session is filed
  // directly under it — only the leaf 'used-folder' actually holds a session.
  assert.equal(existsSync(join(TREE_DIR, 'backend')), true);
});

test('pruneEmptyFolders() never touches the reserved _inbox/_archive directories', () => {
  const before = existsSync(join(TREE_DIR, '_inbox'));
  pruneEmptyFolders();
  assert.equal(existsSync(join(TREE_DIR, '_inbox')), before);
});

test('clearArchive() deletes sessions filed under _archive (and nested) from the store, plus the directory', () => {
  mkdir('_archive/old-project');
  const archived = emptyNeutral('arch-1', 'claude');
  archived.folder = '_archive/old-project';
  saveRaw(archived);
  const kept = emptyNeutral('kept-1', 'claude');
  kept.folder = 'active';
  saveRaw(kept);

  const removed = clearArchive();

  assert.equal(removed, 1);
  assert.equal(loadRaw('arch-1'), null);
  assert.ok(loadRaw('kept-1'));
  assert.equal(existsSync(join(TREE_DIR, '_archive')), false);
});

test('clearArchive() is a harmless no-op when nothing is archived', () => {
  assert.equal(clearArchive(), 0);
});

test('rebuildIndex() drops and rebuilds the sqlite index from raw/ so listSessions() reflects it', () => {
  const n = emptyNeutral('reidx-1', 'claude');
  n.folder = 'reindex-target';
  saveRaw(n);

  const count = rebuildIndex();

  assert.ok(count >= 1);
  assert.ok(listSessions({ folder: 'reindex-target' }).some((r) => r.id === 'reidx-1'));
});

test('tidy() purges meta-call sessions, prunes empty folders, and reindexes — all in one pass', () => {
  const meta = emptyNeutral('tidy-meta-1', 'claude');
  meta.turns = [{ role: 'user', text: `${META_MARKER}\ndo internal work` }];
  saveRaw(meta);
  mkdir('tidy-empty-folder');

  const result = tidy();

  assert.ok(result.meta >= 1);
  assert.ok(result.folders >= 1);
  assert.ok(result.indexed >= 0);
  assert.equal(loadRaw('tidy-meta-1'), null);
  assert.equal(existsSync(join(TREE_DIR, 'tidy-empty-folder')), false);
});

test('resetStore() wipes the entire data home and re-creates the base directories empty', () => {
  const n = emptyNeutral('will-be-wiped', 'claude');
  saveRaw(n);
  assert.ok(loadRaw('will-be-wiped'));

  const returnedHome = resetStore();

  assert.equal(returnedHome, HOME);
  assert.ok(existsSync(HOME));
  assert.ok(existsSync(RAW_DIR));
  assert.equal(loadRaw('will-be-wiped'), null);
});
