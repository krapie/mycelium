/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

'use strict';

/** The oldest CLI whose `serve` this extension can talk to. */
const MIN_CLI = '0.5.0';

/** Negative, 0, positive like a comparator. A pre-release (0.5.0-rc1) sorts below its release. */
function compareVersions(a, b) {
  const parse = (v) => {
    const [core, pre] = String(v).replace(/^v/, '').split('-');
    return { n: core.split('.').map((x) => parseInt(x, 10) || 0), pre: !!pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.n[i] || 0) - (y.n[i] || 0);
    if (d) return d;
  }
  return x.pre === y.pre ? 0 : x.pre ? -1 : 1;
}

const isOutdated = (cliVersion) => compareVersions(cliVersion, MIN_CLI) < 0;

module.exports = { MIN_CLI, compareVersions, isOutdated };
