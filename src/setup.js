/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTERS } from './adapters/index.js';
import { which } from './agents.js';
import { HOME } from './paths.js';

// Shipped command files. Resolved from this module's own URL, not cwd: the
// same command has to work from a global install and from `node src/cli.js`
// in a checkout.
const SOURCE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'agent-commands');

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/**
 * Every installed file carries one marker line naming the command and the
 * hash of the body below it, so a re-run can tell three cases apart that look
 * identical on disk otherwise: a file Mycelium wrote and still owns, one the
 * user has since edited, and one that was never ours. Same reason (and same
 * shape) as reuse.js's `<!-- mycelium:begin:... -->` block in AGENTS.md.
 *
 * The marker goes after any YAML frontmatter — Claude Code and Kiro both
 * parse a leading `---` block, and an HTML comment above it would make the
 * file stop being a command at all.
 */
const MARKER = /^<!-- mycelium:command (\S+) sha=([0-9a-f]+) -->$/m;

function withMarker(body, command) {
  const line = `<!-- mycelium:command ${command} sha=${sha(body)} -->`;
  if (!body.startsWith('---\n')) return `${line}\n${body}`;
  const end = body.indexOf('\n---\n', 4);
  if (end === -1) return `${line}\n${body}`;
  const cut = end + 5;
  return `${body.slice(0, cut)}${line}\n${body.slice(cut)}`;
}

function splitMarker(text) {
  const m = text.match(MARKER);
  if (!m) return null;
  const body = text.replace(`${m[0]}\n`, '');
  return { command: m[1], recorded: m[2], body, intact: sha(body) === m[2] };
}

function classify(dest, shipped) {
  if (!existsSync(dest)) return 'install';
  const found = splitMarker(readFileSync(dest, 'utf8'));
  if (!found) return 'foreign';
  if (!found.intact) return 'modified';
  return found.body === shipped ? 'current' : 'update';
}

/**
 * What a `mycelium setup` run would do, per file, without touching anything.
 *
 * `status` is one of:
 *   install   — not there yet
 *   update    — ours, unmodified, and the shipped copy has changed
 *   current   — ours and already identical
 *   modified  — ours, but edited since; left alone
 *   foreign   — no marker, so it was never ours; left alone
 */
export function planSetup({ adapters = ADAPTERS, isInstalled = (bin) => !!which(bin) } = {}) {
  const plan = [];
  for (const a of adapters) {
    if (!a.commandInstall) continue;
    const entry = { agent: a.name, label: a.label, dir: a.commandInstall.dir, note: a.commandInstall.note, installed: isInstalled(a.bin), files: [] };
    for (const f of a.commandInstall.files) {
      const src = join(SOURCE_DIR, f.from);
      const dest = join(entry.dir, f.to);
      const command = f.to.replace(/\.md$/, '').replace(/\/SKILL$/, '');
      const shipped = readFileSync(src, 'utf8');
      entry.files.push({ to: f.to, dest, command, shipped, wanted: withMarker(shipped, command), status: classify(dest, shipped) });
    }
    plan.push(entry);
  }
  return plan;
}

/**
 * Apply a plan. Only `install` and `update` write; the other three statuses
 * exist so a re-run is a no-op and an edited file is never clobbered.
 * Agents whose CLI isn't on PATH are skipped entirely — installing a command
 * for an agent that isn't there would just be litter.
 *
 * Each file is classified again right before its write: the plan may be
 * seconds old, and a command the user created or edited in between must not
 * be overwritten. A changed status is written back onto the plan so the
 * report says what actually happened. The write goes to a sibling temp file
 * and is renamed over the destination, so an agent reading commands
 * concurrently never sees half a file, and a failed write can't leave one
 * behind that the next run would classify as `modified` and never repair.
 */
export function applySetup(plan) {
  for (const entry of plan) {
    if (!entry.installed) continue;
    for (const f of entry.files) {
      if (f.status !== 'install' && f.status !== 'update') continue;
      f.status = classify(f.dest, f.shipped);
      if (f.status !== 'install' && f.status !== 'update') continue;
      mkdirSync(dirname(f.dest), { recursive: true });
      const tmp = `${f.dest}.${process.pid}.tmp`;
      try {
        writeFileSync(tmp, f.wanted);
        renameSync(tmp, f.dest);
      } catch (e) {
        rmSync(tmp, { force: true });
        throw e;
      }
    }
  }
  return plan;
}

/**
 * Notes for every installed agent that has one, whether or not this run wrote
 * anything: the note covers a step setup can't take for the user, so a re-run
 * (which `mycelium doctor` points at) has to be able to show it again.
 */
export function setupNotes(plan, { home = HOME } = {}) {
  return plan.filter((e) => e.installed && e.note).map((e) => ({ agent: e.agent, label: e.label, text: e.note(home) }));
}

/** Command names Mycelium ships, for `mycelium doctor`'s report. */
export function shippedCommands() {
  return readdirSync(SOURCE_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
}
