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
import { resolveHere } from '../src/here.js';

const claude = { name: 'claude', sessionEnv: 'CLAUDE_CODE_SESSION_ID' };
const codex = { name: 'codex' };

test('resolveHere() takes the session id an adapter says its agent exports', () => {
  assert.deepEqual(resolveHere({ env: { CLAUDE_CODE_SESSION_ID: 'abc' }, adapters: [codex, claude] }), { ok: true, sessionId: 'abc', source: 'claude' });
});

test('resolveHere() fails rather than guess when no agent exported one', () => {
  const r = resolveHere({ env: { PATH: '/usr/bin' }, adapters: [codex, claude] });
  assert.equal(r.ok, false);
  assert.match(r.error, /pass the session id/);
  assert.equal(resolveHere({ env: { CLAUDE_CODE_SESSION_ID: '' }, adapters: [claude] }).ok, false);
});

test('the real Claude Code adapter declares its session env var', async () => {
  const { ADAPTERS } = await import('../src/adapters/index.js');
  assert.equal(ADAPTERS.find((a) => a.name === 'claude').sessionEnv, 'CLAUDE_CODE_SESSION_ID');
});

test('resolveHere() picks the innermost agent when one was started from another\'s shell', () => {
  const kiro = { name: 'kiro', sessionEnv: 'KIRO_SESSION_ID' };
  const env = { CLAUDE_CODE_SESSION_ID: 'outer', KIRO_SESSION_ID: 'inner' };
  const mtimeOf = ({ sessionId }) => ({ outer: 100, inner: 200 })[sessionId];
  assert.equal(resolveHere({ env, adapters: [claude, kiro], mtimeOf }).sessionId, 'inner');
  assert.equal(resolveHere({ env, adapters: [kiro, claude], mtimeOf }).source, 'kiro');
});
