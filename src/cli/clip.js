/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

import { createClip, listClips, findClip, deleteClip, clipFolder, clipText, lastTurnsRange, recentAnswers, setClipNote } from '../clip.js';
import { loadRaw, scan } from '../scanner.js';
import { reindex } from '../index-db.js';
import { resolveHere } from '../here.js';
import { fail, parseFlags, resolveSessionId } from './util.js';

const USAGE =
  'Usage: mycelium clip add <session>|--here [--turn N | --turn N-M | --last N | --list [N]] [--skip-request] [--note "..."] | note <clip> "..." | list [--folder f] [--session s] | show <clip> | rm <clip>';

export function clipCmd(args) {
  const [sub, ...rest] = args;
  if (!sub || sub === 'list') return listCmd(rest);
  if (sub === 'add') return addCmd(rest);
  if (sub === 'note') return noteCmd(rest);
  if (sub === 'show') return showCmd(rest);
  if (sub === 'rm') return rmCmd(rest);
  return fail(USAGE);
}

/**
 * The conversation an agent is running this from. It's usually not captured
 * yet (or captured before the answer being pinned), so scan first — scan()
 * only re-parses transcripts that changed. `rescan: false` skips that for an
 * explicit --turn into a session already captured: turns only ever append,
 * so a number read from `--list` still means the same turn, and a full scan
 * is most of this command's time.
 */
function hereSessionId({ rescan = true } = {}) {
  const here = resolveHere();
  if (!here.ok) fail(here.error);
  if (rescan || !loadRaw(here.sessionId)) {
    scan();
    reindex();
  }
  if (!loadRaw(here.sessionId)) fail(`--here: session ${here.sessionId.slice(0, 8)} is not in the store (deleted from Mycelium, or not written yet)`);
  return here.sessionId;
}

/**
 * Without --turn/--last, print the session's turns numbered instead of
 * guessing — the numbers are what --turn takes, and there's no picker here
 * like the TUI's `p` to choose one interactively. --here is the exception:
 * mid-conversation nobody knows turn numbers, so it means "the answer I just
 * got" (--last 1). --list prints the recent answers instead of pinning, for
 * an agent to pin one by number (see src/agent-commands/).
 */
function addCmd(args) {
  const { flags, positional } = parseFlags(args);
  if (flags.here && positional[0]) return fail('pass a session or --here, not both');
  if (!flags.here && !positional[0]) return fail(USAGE);
  const explicitTurn = typeof flags.turn === 'string';
  const sessionId = flags.here ? hereSessionId({ rescan: !explicitTurn }) : resolveSessionId(positional[0]);
  const note = typeof flags.note === 'string' ? flags.note : '';
  if (flags.list !== undefined) return listAnswers(sessionId, flags);
  if (flags.last !== undefined || (flags.here && typeof flags.turn !== 'string')) {
    const r = lastTurnsRange(loadRaw(sessionId).turns, flags.last === undefined ? 1 : Number(flags.last), { skipRequest: !!flags['skip-request'] });
    if (!r.ok) return fail(r.error);
    return report(createClip({ sessionId, from: r.from, to: r.to, note }), sessionId, true);
  }
  if (typeof flags.turn !== 'string') {
    const n = loadRaw(sessionId);
    n.turns.forEach((t, i) => console.log(`${String(i + 1).padStart(4)}  [${t.role}] ${t.text.replace(/\s+/g, ' ').slice(0, 80)}`));
    return console.log(`\n→ mycelium clip add ${sessionId.slice(0, 8)} --turn <N> (or N-M)`);
  }
  const m = flags.turn.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return fail(USAGE);
  const from = Number(m[1]);
  const to = m[2] ? Number(m[2]) : from;
  report(createClip({ sessionId, from, to, note }), sessionId, !!flags.here);
}

// Read by an agent, which picks a number from it — so the turn numbers and
// the ready-made --turn forms are what matter, and each line stays short.
function listAnswers(sessionId, flags) {
  const count = flags.list === true ? 10 : Number(flags.list);
  if (!Number.isInteger(count) || count < 1) return fail('--list takes a positive count');
  const answers = recentAnswers(loadRaw(sessionId).turns, count, { skipRequest: !!flags['skip-request'] });
  if (!answers.length) return fail('no assistant turn to clip yet');
  const one = (t) => t.replace(/\s+/g, ' ').slice(0, 90);
  console.log(`recent answers in ${sessionId.slice(0, 8)}, oldest first:`);
  for (const a of answers) {
    console.log(`${String(a.turn).padStart(5)}  Q: ${one(a.question)}`);
    console.log(`       A: ${one(a.answer)}`);
  }
  const newest = answers.at(-1).turn;
  console.log(`\nnewest answer: --turn ${newest}   ·   last N turns ending there: --turn <${newest + 1}-N>-${newest}`);
}

// With `preview`, also echo the start of what was pinned: the agent relays
// this line, and it's how the user sees the right answer got clipped.
function report(res, sessionId, preview) {
  if (!res.ok) return fail(res.error);
  const { from, to } = res.clip;
  const range = from === to ? `turn ${from}` : `turns ${from}-${to}`;
  console.log(`clipped ${res.clip.id.slice(0, 8)}  ${sessionId.slice(0, 8)} ${range}  ${res.clip.folder || '_inbox'}`);
  if (preview) console.log(`  ${clipText(res.clip).replace(/\s+/g, ' ').slice(0, 100)}`);
}

function noteCmd(args) {
  const [id, ...words] = args;
  if (!id) return fail(USAGE);
  const found = findClip(id);
  if (!found.ok) return fail(found.error);
  const res = setClipNote(found.clip.id, words.join(' '));
  if (!res.ok) return fail(res.error);
  console.log(`noted ${found.clip.id.slice(0, 8)}  ${res.clip.note || '(cleared)'}`);
}

function listCmd(args) {
  const { flags } = parseFlags(args);
  const clips = listClips({
    folder: typeof flags.folder === 'string' ? flags.folder : undefined,
    sessionId: typeof flags.session === 'string' ? resolveSessionId(flags.session) : undefined,
  });
  if (!clips.length) return console.log('no clips');
  for (const c of clips) {
    const range = c.from === c.to ? `#${c.from}` : `#${c.from}-${c.to}`;
    console.log(`${c.id.slice(0, 8)}  ${clipFolder(c) || '_inbox'}  ${c.sessionId.slice(0, 8)} ${range}${c.note ? `  ${c.note}` : ''}`);
    console.log(`          ${clipText(c).replace(/\s+/g, ' ').slice(0, 70)}`);
  }
}

function showCmd(args) {
  if (!args[0]) return fail(USAGE);
  const found = findClip(args[0]);
  if (!found.ok) return fail(found.error);
  const c = found.clip;
  if (c.note) console.log(`# ${c.note}\n`);
  console.log(`${c.source} · ${c.sessionTitle || c.sessionId.slice(0, 8)} · ${clipFolder(c) || '_inbox'}\n`);
  console.log(clipText(c));
}

function rmCmd(args) {
  if (!args[0]) return fail(USAGE);
  const found = findClip(args[0]);
  if (!found.ok) return fail(found.error);
  const res = deleteClip(found.clip.id);
  if (!res.ok) return fail(res.error);
  console.log(`removed clip ${found.clip.id.slice(0, 8)}`);
}
