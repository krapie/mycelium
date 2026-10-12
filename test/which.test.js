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
import { useTempHome } from './helpers.js';

useTempHome();
const { which } = await import('../src/agents.js');

const present = (...paths) => (p) => paths.includes(p);

test('which() on POSIX splits PATH on ":" and looks for the bare name', () => {
  const env = { PATH: '/usr/bin:/opt/homebrew/bin' };
  assert.equal(which('claude', { platform: 'linux', env, exists: present('/opt/homebrew/bin/claude') }), true);
  assert.equal(which('claude', { platform: 'linux', env, exists: present('/elsewhere/claude') }), false);
  assert.equal(which('claude', { platform: 'darwin', env: {}, exists: () => true }), false, 'no PATH, nothing to search');
});

test('which() on Windows splits on ";" so drive letters survive, and tries PATHEXT', () => {
  const env = { Path: 'C:\\Windows\\System32;C:\\Users\\me\\AppData\\Roaming\\npm', PATHEXT: '.COM;.EXE;.BAT;.CMD' };
  const npmShim = 'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.CMD';
  assert.equal(which('claude', { platform: 'win32', env, exists: present(npmShim) }), true, 'the npm .cmd shim, found through a differently-cased `Path`');
  assert.equal(which('claude', { platform: 'win32', env, exists: present('C:\\Windows\\System32\\claude.EXE') }), true);
  assert.equal(which('claude', { platform: 'win32', env, exists: present('C:\\nowhere\\claude.EXE') }), false);
});

test('which() on Windows ignores quotes around PATH entries and falls back to default PATHEXT', () => {
  const env = { PATH: '"C:\\Program Files\\nodejs";C:\\bin' };
  assert.equal(which('codex', { platform: 'win32', env, exists: present('C:\\Program Files\\nodejs\\codex.EXE') }), true);
});

test('which() with a name that already has an extension still matches it as given', () => {
  const env = { PATH: 'C:\\bin' };
  assert.equal(which('tool.exe', { platform: 'win32', env, exists: present('C:\\bin\\tool.exe') }), true);
});
