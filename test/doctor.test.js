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
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers.js';

const homeDir = useTempHome();
const { collectDiagnostics, formatDiagnostics, codexSandbox } = await import('../src/doctor.js');
const { whichPath, which } = await import('../src/agents.js');
const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));

test('whichPath returns where the program was found, which() stays a boolean', () => {
  const exists = (p) => p === '/b/claude';
  assert.equal(whichPath('claude', { env: { PATH: '/a:/b' }, platform: 'linux', exists }), '/b/claude');
  assert.equal(whichPath('codex', { env: { PATH: '/a:/b' }, platform: 'linux', exists }), null);
  assert.equal(which('claude', { env: { PATH: '/a:/b' }, platform: 'linux', exists }), true);
});

test('collectDiagnostics reports missing agents and honours extraPath', () => {
  const d = collectDiagnostics({ env: { PATH: '/nowhere' }, platform: 'linux' });
  assert.ok(d.agents.length >= 3);
  assert.ok(d.agents.every((a) => a.path === null));
  assert.equal(d.home, homeDir);
  assert.equal(d.store.sessions, 0);
  const wider = collectDiagnostics({ env: { PATH: '/nowhere' }, platform: 'linux', extraPath: ['/extra'] });
  assert.deepEqual(wider.path, ['/extra', '/nowhere']);
});

test('formatDiagnostics hides the home directory and flags missing programs', () => {
  const d = collectDiagnostics({ env: { PATH: '/home/me/bin' }, platform: 'linux' });
  const text = formatDiagnostics(d, { home: '/home/me' });
  assert.match(text, /NOT FOUND/);
  assert.match(text, /~\/bin/);
  assert.doesNotMatch(text, /\/home\/me/);
});

test('mycelium doctor --json runs end-to-end and prints parseable JSON', () => {
  const out = execFileSync(process.execPath, [cliPath, 'doctor', '--json'], { env: { ...process.env, MYCELIUM_HOME: homeDir }, encoding: 'utf8' });
  assert.equal(typeof JSON.parse(out).version, 'string');
});

test('collectDiagnostics widens the Windows Path key instead of adding a second PATH', () => {
  const d = collectDiagnostics({ env: { Path: '/a' }, platform: 'win32', extraPath: ['/extra'] });
  assert.deepEqual(d.path, ['/extra', '/a']);
});

test('credentials in the sync remote never reach the report', async () => {
  const { saveConfig, loadConfig } = await import('../src/config.js');
  saveConfig({ ...loadConfig(), sync: { remote: 'https://me:s3cret@github.com/me/store.git', mode: 'push' } });
  const d = collectDiagnostics({ env: { PATH: '/x' }, platform: 'linux' });
  assert.equal(d.sync.remote, 'https://***@github.com/me/store.git');
});

test('collectDiagnostics flags a daemon running a different version than the installed CLI (#203)', async () => {
  const { writeFileSync, rmSync } = await import('node:fs');
  const { DAEMON_PID_PATH, DAEMON_VERSION_PATH } = await import('../src/paths.js');
  const { VERSION } = await import('../src/version.js');
  try {
    writeFileSync(DAEMON_PID_PATH, String(process.pid));
    assert.match(collectDiagnostics().store.daemon, /^running \(vunknown, installed .*stale/);
    writeFileSync(DAEMON_VERSION_PATH, '0.0.1');
    assert.match(collectDiagnostics().store.daemon, /v0\.0\.1, installed .*stale/);
    writeFileSync(DAEMON_VERSION_PATH, VERSION);
    assert.equal(collectDiagnostics().store.daemon, `running (v${VERSION})`);
  } finally {
    rmSync(DAEMON_PID_PATH, { force: true });
    rmSync(DAEMON_VERSION_PATH, { force: true });
  }
});

test('codexSandbox counts only an active, exact writable root', async () => {
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const cfg = join(homeDir, 'codex-config.toml');
  const check = (toml, store = '/home/u/.mycelium') => {
    writeFileSync(cfg, toml);
    return codexSandbox(store, cfg).configured;
  };
  assert.equal(check('[sandbox_workspace_write]\nwritable_roots = ["/home/u/.mycelium"]\n'), true);
  assert.equal(check('[sandbox_workspace_write]\nwritable_roots = ["/a", "/home/u/.mycelium/"]\n'), true, 'trailing slash is the same root');
  assert.equal(check('[sandbox_workspace_write]\n# writable_roots = ["/home/u/.mycelium"]\n'), false, 'a commented-out line is ignored');
  assert.equal(check('[sandbox_workspace_write]\nwritable_roots = ["/home/u/.mycelium-old"]\n'), false, 'a prefix match is not the store');
  assert.equal(check('[other]\nwritable_roots = ["/home/u/.mycelium"]\n'), false, 'only the sandbox table counts');
  assert.equal(check('[sandbox_workspace_write]\nwritable_roots = ["C:\\\\Users\\\\u\\\\.mycelium"]\n', 'C:\\Users\\u\\.mycelium'), true, 'escaped backslashes are decoded');
  assert.equal(codexSandbox('/x', join(homeDir, 'nope.toml')).configured, false);
});

test('the sandbox warning needs Codex installed, and an unreadable config is reported separately', () => {
  const base = { version: '0', node: 'v', platform: 'p', shell: null, locale: 'en', home: '/s', store: {}, agents: [], path: [], llm: {}, git: null, ssh: null };
  const files = [{ to: 'clip/SKILL.md', status: 'current' }];
  const missing = { path: '/c.toml', configured: false };
  const out = (commands, codexSandbox) => formatDiagnostics({ ...base, commands, codexSandbox }, { home: '/h' });
  assert.match(out([{ agent: 'codex', installed: true, dir: '/d', files }], missing), /not in writable_roots/);
  assert.doesNotMatch(out([{ agent: 'codex', installed: false, dir: '/d', files: [] }, { agent: 'claude', installed: true, dir: '/d', files }], missing), /writable_roots/);
  assert.match(out([{ agent: 'codex', installed: true, dir: '/d', files }], { path: '/c.toml', configured: null }), /could not read/);
});
