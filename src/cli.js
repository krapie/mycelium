#!/usr/bin/env node
/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

import './quiet-warnings.js';
import { VERSION } from './version.js';
import { scanCmd, reindexCmd, archiveCmd } from './cli/capture.js';
import { organizeCmd, mkdirCmd, mvCmd, tagCmd, unmergeCmd, unsplitCmd } from './cli/organize.js';
import { autotagCmd, digestCmd, knowledgeCmd } from './cli/learn.js';
import { contextCmd, injectCmd, handoffCmd, resumeCmd } from './cli/reuse.js';
import { searchCmd, listCmd, tagsCmd } from './cli/find.js';
import { backlogCmd } from './cli/backlog.js';
import { clipCmd } from './cli/clip.js';
import { cleanupCmd } from './cli/cleanup.js';
import { daemonCmd, demoCmd, langCmd } from './cli/run.js';
import { serveCmd } from './cli/serve.js';
import { doctorCmd } from './cli/doctor.js';
import { setupCmd } from './cli/setup.js';
import { printHelp } from './cli/help.js';

// Dispatch table — barrel-adjacent to organize.js/daemon.js's own
// barrel+siblings pattern: each command's real implementation lives in its
// own cli/*.js sibling, grouped the same way docs/cli.md and printHelp()'s
// own output already group them (Capture/Organize/Learn/Reuse/Find/Run/Clean).
const COMMANDS = {
  scan: scanCmd,
  reindex: reindexCmd,
  archive: archiveCmd,
  organize: organizeCmd,
  mkdir: mkdirCmd,
  mv: mvCmd,
  tag: tagCmd,
  unmerge: unmergeCmd,
  unsplit: unsplitCmd,
  backlog: backlogCmd,
  clip: clipCmd,
  autotag: autotagCmd,
  digest: digestCmd,
  knowledge: knowledgeCmd,
  context: contextCmd,
  inject: injectCmd,
  handoff: handoffCmd,
  resume: resumeCmd,
  search: searchCmd,
  list: listCmd,
  tags: tagsCmd,
  cleanup: cleanupCmd,
  daemon: daemonCmd,
  serve: serveCmd,
  doctor: doctorCmd,
  setup: setupCmd,
  demo: demoCmd,
  lang: langCmd,
};

async function main() {
  const [, , cmd, ...args] = process.argv;
  if (cmd === '--version' || cmd === '-v' || cmd === '-V') {
    console.log(`mycelium v${VERSION}`);
    process.exit(0);
  }
  // No command (or `tui`) → launch the interactive cockpit. `--tutorial`
  // is internal — only `demo` (cli/run.js) passes it, to skip straight into
  // the tutorial instead of the normal first-run yes/no prompt.
  if (!cmd || cmd === 'tui') {
    const { runTui } = await import('./tui/index.js');
    return runTui({ forceTutorial: args.includes('--tutorial') });
  }
  const handler = COMMANDS[cmd];
  if (!handler) return printHelp(cmd);
  return handler(args);
}

main();
