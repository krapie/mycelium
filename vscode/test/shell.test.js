/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { shellKind, commandFor, needsFallbackShell } = require('../src/shell.js');
const { compareVersions, isOutdated, MIN_CLI } = require('../src/version.js');

test('shellKind reads the shell from its path, on either OS', () => {
  assert.equal(shellKind('/bin/zsh'), 'posix');
  assert.equal(shellKind('/usr/bin/fish'), 'posix');
  assert.equal(shellKind('C:\\Program Files\\PowerShell\\7\\pwsh.exe'), 'powershell');
  assert.equal(shellKind('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'), 'powershell');
  assert.equal(shellKind('C:\\Windows\\System32\\cmd.exe'), 'cmd');
  assert.equal(shellKind(undefined), 'posix');
});

test('bash/zsh: plain words stay bare, anything else is single-quoted with embedded quotes escaped', () => {
  assert.equal(commandFor('/bin/zsh', 'claude', ['--resume', 'abc-123']), 'claude --resume abc-123');
  assert.equal(commandFor('/bin/bash', 'claude', ['it\'s a $HOME; rm -rf *']), "claude 'it'\\''s a $HOME; rm -rf *'");
  assert.equal(commandFor('/bin/bash', 'claude', []), 'claude');
});

test('PowerShell: call operator, every argument single-quoted, quotes doubled', () => {
  assert.equal(commandFor('C:\\x\\pwsh.exe', 'claude', ['--resume', 'abc']), "& 'claude' '--resume' 'abc'");
  assert.equal(commandFor('C:\\x\\pwsh.exe', 'codex', ["it's $env:PATH & more"]), "& 'codex' 'it''s $env:PATH & more'");
  assert.equal(commandFor('C:\\x\\pwsh.exe', 'claude', []), "& 'claude'");
});

test('PowerShell also treats typographic single quotes as quotes, so every one is doubled', () => {
  // ’ would otherwise end the string and let what follows run as code
  assert.equal(commandFor('C:\\x\\pwsh.exe', 'codex', ['don\u2019t \u2018x\u2019; calc']), "& 'codex' 'don\u2019\u2019t \u2018\u2018x\u2019\u2019; calc'");
});

test('cmd: harmless words are written out, spaces get quotes, and nothing else is ever quoted for cmd', () => {
  const cmd = 'C:\\Windows\\System32\\cmd.exe';
  assert.equal(commandFor(cmd, 'claude', ['--resume', 'abc']), 'claude --resume abc');
  assert.equal(commandFor(cmd, 'claude', ['two words']), 'claude "two words"');
  for (const bad of ['say "hi" & calc', 'a & b', '50%', 'x^y', 'a|b', 'a<b', 'line\nbreak', 'it\u2019s', '!x!']) {
    assert.throws(() => commandFor(cmd, 'claude', [bad]), /cannot safely quote/, JSON.stringify(bad));
  }
});

test('a prompt that cmd cannot carry makes the launch fall back to PowerShell; other shells never do', () => {
  const cmd = 'C:\\Windows\\System32\\cmd.exe';
  assert.equal(needsFallbackShell(cmd, 'claude', ['continue the work: "a & b"']), true);
  assert.equal(needsFallbackShell(cmd, 'claude', ['--resume', 'abc-123']), false);
  assert.equal(needsFallbackShell('C:\\x\\pwsh.exe', 'claude', ['"a & b"']), false);
  assert.equal(needsFallbackShell('/bin/zsh', 'claude', ['"a & b"']), false);
});

test('compareVersions orders numerically and puts a pre-release below its release', () => {
  assert.ok(compareVersions('0.10.0', '0.9.9') > 0);
  assert.ok(compareVersions('0.4.5', '0.5.0') < 0);
  assert.equal(compareVersions('v1.2.3', '1.2.3'), 0);
  assert.ok(compareVersions('0.5.0-rc1', '0.5.0') < 0);
  assert.ok(compareVersions('0.5.1', '0.5.0-rc1') > 0);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
});

test('isOutdated against MIN_CLI', () => {
  assert.equal(MIN_CLI, '0.5.0');
  assert.equal(isOutdated('0.4.5'), true);
  assert.equal(isOutdated('0.5.0'), false);
  assert.equal(isOutdated('0.5.0-rc1'), true);
  assert.equal(isOutdated('1.0.0'), false);
});
