/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

import { readFileSync } from 'node:fs';

// Resolves through symlinks to the real package.json regardless of install
// method (npm global, Homebrew Cellar, npm-link dev checkout) — always
// reflects what's actually running, no separate constant to keep in sync.
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));

export const VERSION = pkg.version;

/**
 * The version currently on disk, which differs from VERSION once the package
 * is reinstalled underneath a running process (#203). A reinstall can leave
 * package.json briefly missing or half-written, so any failure returns null
 * ("unknown"), never a version.
 */
export function installedVersion() {
  try {
    const v = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}
