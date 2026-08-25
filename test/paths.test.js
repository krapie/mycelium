import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers.js';

const tempHome = useTempHome();

// Dynamic import — see helpers.js's useTempHome() doc comment for why this
// can't be a static top-level import here.
const paths = await import('../src/paths.js');

test('HOME resolves from MYCELIUM_HOME, not the real ~/.mycelium', () => {
  assert.equal(paths.HOME, tempHome);
});

test('RAW_DIR/TREE_DIR/DB_PATH/CONFIG_PATH all nest under HOME', () => {
  assert.equal(paths.RAW_DIR, join(tempHome, 'raw'));
  assert.equal(paths.TREE_DIR, join(tempHome, 'tree'));
  assert.equal(paths.DB_PATH, join(tempHome, 'db', 'index.db'));
  assert.equal(paths.CONFIG_PATH, join(tempHome, 'config.json'));
  assert.equal(paths.INBOX, join(tempHome, 'tree', '_inbox'));
});

test('ensureDirs() creates every directory it promises to, idempotently', () => {
  assert.equal(existsSync(paths.RAW_DIR), false);
  paths.ensureDirs();
  for (const d of [paths.HOME, paths.RAW_DIR, paths.TREE_DIR, paths.DIGEST_DIR, paths.DB_DIR, paths.INBOX]) {
    assert.equal(existsSync(d), true, d);
  }
  paths.ensureDirs(); // second call must not throw
});

test('isSafeFolderPath() accepts ordinary nested folder paths', () => {
  assert.equal(paths.isSafeFolderPath('auth'), true);
  assert.equal(paths.isSafeFolderPath('auth/token-refresh'), true);
});

test('isSafeFolderPath() rejects POSIX traversal and absolute paths', () => {
  assert.equal(paths.isSafeFolderPath('..'), false);
  assert.equal(paths.isSafeFolderPath('../outside'), false);
  assert.equal(paths.isSafeFolderPath('team/../../outside'), false);
  assert.equal(paths.isSafeFolderPath('/outside'), false);
  assert.equal(paths.isSafeFolderPath('team/./project'), false);
});

// Checked with path.win32 explicitly (not the host's own platform-default
// path module), since these must be rejected the same way on a Mac/Linux
// CI runner as on a real Windows user's machine — found via CodeRabbit
// review on #91, one round after the first POSIX-only version of this
// function shipped.
test('isSafeFolderPath() rejects Windows-style traversal, drive-qualified, and UNC paths', () => {
  assert.equal(paths.isSafeFolderPath('..\\outside'), false);
  assert.equal(paths.isSafeFolderPath('team\\..\\outside'), false);
  assert.equal(paths.isSafeFolderPath('C:\\outside'), false);
  assert.equal(paths.isSafeFolderPath('C:/outside'), false);
  assert.equal(paths.isSafeFolderPath('C:foo'), false);
  assert.equal(paths.isSafeFolderPath('\\\\server\\share'), false);
  assert.equal(paths.isSafeFolderPath('//server/share'), false);
  assert.equal(paths.isSafeFolderPath('\\outside'), false);
});

test('isSafeFolderPath() rejects non-string/empty input', () => {
  assert.equal(paths.isSafeFolderPath(''), false);
  assert.equal(paths.isSafeFolderPath(null), false);
  assert.equal(paths.isSafeFolderPath(undefined), false);
});
