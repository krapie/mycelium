/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

import { collectDiagnostics, formatDiagnostics } from '../doctor.js';

/** `mycelium doctor [--json]` — environment report to paste into a bug report. */
export function doctorCmd(args = []) {
  const d = collectDiagnostics();
  console.log(args.includes('--json') ? JSON.stringify(d, null, 2) : formatDiagnostics(d));
}
