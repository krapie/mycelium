/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

import { homedir } from 'node:os';
import { applySetup, planSetup, setupNotes } from '../setup.js';
import { parseFlags } from './util.js';

// Past tense for a real run, future for --dry-run: the same table is printed
// either way, so the verb is the only thing that says which one happened.
const VERB = {
  install: ['installed', 'would install'],
  update: ['updated', 'would update'],
  current: ['already current', 'already current'],
  modified: ['edited since install — left alone', 'edited since install — would leave alone'],
  foreign: ['not installed by Mycelium — left alone', 'not installed by Mycelium — would leave alone'],
};

/** `mycelium setup [--dry-run]` — install each installed agent's `/clip` command. */
export function setupCmd(args = []) {
  const { flags } = parseFlags(args);
  // parseFlags() hands a following bare word to the flag as its value, so
  // `--dry-run extra` must still be a preview, never a real install.
  const dry = flags['dry-run'] !== undefined;
  const i = dry ? 1 : 0;
  const home = homedir();
  const hide = (p) => (home ? String(p).split(home).join('~') : p);

  const plan = planSetup();
  if (!plan.length) return console.log('No agent in the registry ships a command file.');
  if (!dry) applySetup(plan);

  for (const entry of plan) {
    if (!entry.installed) {
      console.log(`${entry.label}: not installed (${entry.agent}) — skipped`);
      continue;
    }
    console.log(`${entry.label}: ${hide(entry.dir)}`);
    for (const f of entry.files) console.log(`  ${f.to.padEnd(14)} ${VERB[f.status][i]}`);
  }

  // Not run through hide(): these are lines to paste into a config file, so
  // the path has to be the real absolute one, not a display `~`.
  for (const n of setupNotes(plan)) console.log(`\n${n.text}\n`);

  const changed = plan.filter((e) => e.installed).flatMap((e) => e.files).filter((f) => f.status === 'install' || f.status === 'update').length;
  if (dry && changed) console.log(`\n${changed} file(s) would change — re-run without --dry-run to apply.`);
}
