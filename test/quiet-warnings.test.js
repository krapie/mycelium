/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

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
