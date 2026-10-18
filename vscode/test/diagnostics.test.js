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
const { formatDiagnostics } = require('../src/diagnostics.js');

const editor = { extensionVersion: '0.2.4', appName: 'Visual Studio Code', vscodeVersion: '1.99.0', platform: 'darwin arm64', remoteName: undefined, language: 'en', claudeCodeInstalled: true, configuredPath: '', configuredHome: '', hostPath: ['/usr/bin'] };

test('reports the editor side and a missing CLI without the doctor report', () => {
  const text = formatDiagnostics({ editor, resolved: { command: 'mycelium', from: null, searched: ['/a', '/b'] }, cliError: 'spawn mycelium ENOENT', home: '/Users/me' });
  assert.match(text, /Mycelium for VS Code 0\.2\.4/);
  assert.match(text, /CLI: NOT FOUND\. Looked in 2 directories/);
  assert.match(text, /mycelium doctor failed: spawn mycelium ENOENT/);
});

test('includes the CLI report and hides the home directory', () => {
  const text = formatDiagnostics({ editor, resolved: { command: '/Users/me/.nvm/bin/mycelium', from: 'known location', searched: [] }, loginDirs: ['/x'], cli: { version: '0.5.4', home: '/Users/me/.mycelium' }, home: '/Users/me' });
  assert.match(text, /CLI: ~\/\.nvm\/bin\/mycelium \(found via known location\)/);
  assert.match(text, /"home": "~\/\.mycelium"/);
  assert.doesNotMatch(text, /\/Users\/me/);
});
