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
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

// Every adapter's install dir reads an env override (see base.js's contract),
// which is what keeps this file out of the real ~/.claude, ~/.kiro and
// ~/.codex — writing there would be worse than touching ~/.mycelium, since
// those hold the user's own commands. Set before importing the adapters:
// each resolves its dir once at module load, the same reason
// test/helpers.js's useTempHome() has to run before importing paths.js users.
const root = mkdtempSync(join(tmpdir(), 'myc-setup-'));
process.env.CLAUDE_COMMANDS_DIR = join(root, 'claude', 'commands');
process.env.KIRO_PROMPTS_DIR = join(root, 'kiro', 'prompts');
process.env.CODEX_SKILLS_DIR = join(root, 'codex', 'skills');

const { planSetup, applySetup, setupNotes, shippedCommands } = await import('../src/setup.js');
const { ADAPTERS } = await import('../src/adapters/index.js');

const only = (name) => ADAPTERS.filter((a) => a.name === name);
// Claude for the status matrix — one file, and its shipped copy has frontmatter.
// The other adapters are the same code path with a different dir.
const run = (opts = {}) => planSetup({ adapters: only('claude'), isInstalled: () => true, ...opts });
const dest = () => join(process.env.CLAUDE_COMMANDS_DIR, 'clip.md');
const marker = (text) => text.match(/^<!-- mycelium:command (\S+) sha=([0-9a-f]{16}) -->$/m);

test('a first run installs the command and stamps it with a marker naming the body hash', () => {
  const plan = run();
  assert.equal(plan[0].files[0].status, 'install');
  applySetup(plan);

  const text = readFileSync(dest(), 'utf8');
  const m = marker(text);
  assert.ok(m, 'installed file should carry a marker');
  assert.equal(m[1], 'clip');
  // Additional, not a replacement: the shipped body has to survive verbatim,
  // or the agent would read a command Mycelium rewrote.
  assert.ok(text.includes('mycelium clip add --here'), 'shipped body should still be there');
});

test('the marker goes below YAML frontmatter, so the file stays a valid command', () => {
  const text = readFileSync(dest(), 'utf8');
  assert.ok(text.startsWith('---\n'), 'frontmatter must still open the file');
  const closing = text.indexOf('\n---\n', 4) + 5;
  assert.equal(text.slice(closing), `${marker(text)[0]}\n${text.slice(closing).split('\n').slice(1).join('\n')}`);
  assert.ok(marker(text).index > closing - 5, 'marker should sit after the frontmatter block');
});

test('a second run with nothing changed reports current and rewrites nothing', () => {
  const before = readFileSync(dest(), 'utf8');
  const plan = run();
  assert.equal(plan[0].files[0].status, 'current');
  applySetup(plan);
  assert.equal(readFileSync(dest(), 'utf8'), before);
});

test('a file the user edited is reported modified and left exactly as it was', () => {
  const edited = `${readFileSync(dest(), 'utf8')}\n\nmy own extra instruction\n`;
  writeFileSync(dest(), edited);

  const plan = run();
  assert.equal(plan[0].files[0].status, 'modified');
  applySetup(plan);
  assert.equal(readFileSync(dest(), 'utf8'), edited, 'must not clobber a user edit');
});

test('a file with no marker was never ours, so it is left alone too', () => {
  writeFileSync(dest(), '# my own clip command\n');
  const plan = run();
  assert.equal(plan[0].files[0].status, 'foreign');
  applySetup(plan);
  assert.equal(readFileSync(dest(), 'utf8'), '# my own clip command\n');
});

test('an unmodified file whose shipped copy moved on is updated', () => {
  rmSync(dest());
  applySetup(run());
  const shipped = readFileSync(dest(), 'utf8');

  // Fake "Mycelium shipped an older version": a marker whose hash matches its
  // own stale body, so it reads as ours-and-unmodified. Status then has to
  // come from comparing the body to the shipped one, not from the file
  // merely existing and being intact.
  const stale = 'old body\n';
  const staleSha = createHash('sha256').update(stale).digest('hex').slice(0, 16);
  writeFileSync(dest(), `<!-- mycelium:command clip sha=${staleSha} -->\n${stale}`);

  const plan = run();
  assert.equal(plan[0].files[0].status, 'update');
  applySetup(plan);
  assert.equal(readFileSync(dest(), 'utf8'), shipped, 'update should restore the shipped body');
});

test('an agent whose CLI is not on PATH is planned but never written', () => {
  rmSync(dest());
  const plan = planSetup({ adapters: only('claude'), isInstalled: () => false });
  assert.equal(plan[0].installed, false);
  assert.equal(plan[0].files[0].status, 'install', 'the plan still says what it would do');
  applySetup(plan);
  assert.equal(existsSync(dest()), false, 'nothing should be written for a missing agent');
});

test('a nested destination (Codex skills/<name>/SKILL.md) gets its directory created', () => {
  applySetup(planSetup({ adapters: only('codex'), isInstalled: () => true }));
  assert.ok(existsSync(join(process.env.CODEX_SKILLS_DIR, 'clip', 'SKILL.md')));
});

test('the Codex note carries the store path, and a re-run still shows it', () => {
  rmSync(join(process.env.CODEX_SKILLS_DIR, 'clip', 'SKILL.md'), { force: true });
  const plan = planSetup({ adapters: only('codex'), isInstalled: () => true });
  const notes = setupNotes(plan, { home: '/tmp/store-xyz' });
  assert.equal(notes.length, 1);
  assert.match(notes[0].text, /\[sandbox_workspace_write\]/);
  assert.match(notes[0].text, /writable_roots = \["\/tmp\/store-xyz"\]/);

  // The note is the only place the user is told about writable_roots, so it
  // must survive the skill becoming current.
  applySetup(plan);
  const after = planSetup({ adapters: only('codex'), isInstalled: () => true });
  assert.equal(after[0].files[0].status, 'current');
  assert.equal(setupNotes(after).length, 1);
  assert.equal(setupNotes(planSetup({ adapters: only('codex'), isInstalled: () => false })).length, 0, 'no note for an agent that is not installed');
});

test('the Codex note escapes backslashes, so a Windows store path stays valid TOML', () => {
  const [n] = setupNotes(planSetup({ adapters: only('codex'), isInstalled: () => true }), { home: 'C:\\Users\\me\\.mycelium' });
  assert.ok(n.text.includes('writable_roots = ["C:\\\\Users\\\\me\\\\.mycelium"]'), n.text);
});

test('a file that appeared or was edited after planning is not overwritten by applySetup', () => {
  rmSync(dest(), { force: true });
  const planned = run();
  assert.equal(planned[0].files[0].status, 'install');
  writeFileSync(dest(), 'my own /clip\n');
  applySetup(planned);
  assert.equal(readFileSync(dest(), 'utf8'), 'my own /clip\n');
  assert.equal(planned[0].files[0].status, 'foreign', 'the report should say it was left alone');
  assert.deepEqual(readdirSync(process.env.CLAUDE_COMMANDS_DIR).filter((f) => f.endsWith('.tmp')), []);
});

test('only Codex carries a note — the other agents need no out-of-band step', () => {
  const noted = ADAPTERS.filter((a) => a.commandInstall?.note).map((a) => a.name);
  assert.deepEqual(noted, ['codex']);
});

test('an adapter with no commandInstall is skipped entirely', () => {
  assert.deepEqual(planSetup({ adapters: only('opencode'), isInstalled: () => true }), []);
});

test('every adapter declaring commandInstall points at shipped files that exist', () => {
  const declaring = ADAPTERS.filter((a) => a.commandInstall);
  assert.ok(declaring.length >= 3, 'claude, kiro and codex should all declare one');
  for (const a of declaring) {
    const plan = planSetup({ adapters: [a], isInstalled: () => true });
    for (const f of plan[0].files) assert.ok(f.wanted.length > 0, `${a.name}: ${f.to} should have shipped content`);
  }
});

test('shipped files are resolved from the module, not the cwd', () => {
  const prev = process.cwd();
  process.chdir(tmpdir());
  try {
    assert.ok(shippedCommands().includes('claude'), 'should resolve relative to src/, not cwd');
  } finally {
    process.chdir(prev);
  }
});

test('`setup --dry-run extra` is still a preview: a stray word after the flag never turns it into an install', () => {
  rmSync(dest(), { force: true });
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\n');
  chmodSync(join(bin, 'claude'), 0o755);
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const r = spawnSync(process.execPath, [cli, 'setup', '--dry-run', 'extra'], {
    encoding: 'utf8',
    env: { ...process.env, MYCELIUM_HOME: join(root, 'home'), PATH: `${bin}${delimiter}${process.env.PATH}` },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /would install/);
  assert.equal(existsSync(dest()), false, 'a dry run must not write');
});
