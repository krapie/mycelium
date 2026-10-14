/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

// Fills an isolated store with realistic sessions so the extension can be
// looked at without touching the real ~/.mycelium. Usage: node seed-dev-store.mjs [en|ko]
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const locale = process.argv[2] === 'en' ? 'en' : 'ko';
const home = join(homedir(), '.mycelium-vscode-dev');
const repoDir = join(homedir(), '.mycelium-vscode-dev-repo');
const othersDir = join(homedir(), '.mycelium-vscode-dev-repo-others');
const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/cli.js');
const MARKER = '.vscode-dev-owned';

// Only ever wipe a directory this script created — never one that merely
// happens to sit at the same path.
for (const d of [home, repoDir, othersDir]) {
  if (existsSync(d)) {
    if (!existsSync(join(d, MARKER))) {
      console.error(`${d} exists and is not a dev store from this script; refusing to touch it`);
      process.exit(1);
    }
    rmSync(d, { recursive: true, force: true });
  }
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, MARKER), '');
}

// paths.js reads MYCELIUM_HOME once at import time, so set it before any import.
process.env.MYCELIUM_HOME = home;
const { PERSONAS } = await import('../../src/tui/personas.js');
const { buildMockSessions } = await import('../../src/tui/tutorial-data.js');
const { saveRaw } = await import('../../src/scanner.js');
const { writeKnowledgeText, writePendingKnowledgeText } = await import('../../src/insight/knowledge.js');
const { reindex } = await import('../../src/index-db.js');

// The first persona's sessions ran in the workspace the dev window opens, so
// "This Workspace" has something in it; the others ran elsewhere, so it is
// visibly a subset of "Recent" and "Folders".
let total = 0;
for (const [pi, persona] of PERSONAS.entries()) {
  let dir = repoDir;
  if (pi > 0) {
    dir = join(othersDir, persona.id);
    mkdirSync(dir, { recursive: true });
  }
  const built = buildMockSessions(persona.id, locale, dir);
  let i = 0;
  for (const [si, story] of persona.storylines.entries()) {
    const mine = built.slice(i, (i += story.sessions.length));
    mine.forEach((n, k) => {
      delete n.demo; // look like captured sessions, not tutorial mocks
      // The last session of each storyline stays unfiled so "New" has content.
      if (k < mine.length - 1) {
        n.folder = story.folder;
        n.organizedBy = 'auto';
      } else if (si === 0) {
        // ...and one per persona has no summary yet, so "Summarize" has work to do.
        n.extracted = { title: null, tags: [], summary: null, decisions: [], todos: [] };
        n.summarizedTurnCount = null;
      }
      saveRaw(n);
      total++;
    });
    writeKnowledgeText(story.folder, story.knowledge[locale]);
  }
}
// A proposal waiting for review, as if the daemon had staged it overnight.
const first = PERSONAS[0].storylines[PERSONAS[0].mergeStorylineIndex ?? 0];
writePendingKnowledgeText(first.folder, `${first.knowledge[locale]}\n- ${locale === 'ko' ? '**제안**: 개발용 샘플 제안입니다.' : '**Proposed**: a sample update for the review flow.'}`);
reindex();

mkdirSync(join(repoDir, '.vscode'), { recursive: true });
writeFileSync(join(repoDir, '.vscode', 'settings.json'), JSON.stringify({ 'mycelium.path': cli, 'mycelium.home': home }, null, 2) + '\n');
console.log(`seeded ${total} sessions in ${home}\nworkspace: ${repoDir}`);
