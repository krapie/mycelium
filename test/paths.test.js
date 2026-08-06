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
