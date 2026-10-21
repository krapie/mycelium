/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { emptyNeutral } from '../schema.js';

export const name = 'codex';
export const label = 'Codex';
export const bin = 'codex';
export const newArgs = (seed) => (seed ? [seed] : []);
export const resumeArgs = (sessionId) => ['resume', sessionId];
// The thread id is the rollout filename's uuid (the session id below). Found
// in codex 0.162's exec_command environment list, not yet observed at
// runtime: if it isn't set, `--here` just fails and asks for the id.
export const sessionEnv = 'CODEX_THREAD_ID';
// `$clip`. Codex 0.163 has skills (a directory per skill holding SKILL.md)
// and no ~/.codex/prompts, so this is the only shape available here.
export const commandInstall = {
  dir: process.env.CODEX_SKILLS_DIR || join(homedir(), '.codex', 'skills'),
  files: [{ from: 'codex/clip/SKILL.md', to: 'clip/SKILL.md' }],
  // Codex's sandbox denies writes outside the workspace, so the skill can't
  // reach the store until this is added. `mycelium setup` only ever PRINTS
  // it: widening writable_roots moves a security boundary, which is the
  // user's call, not a tool's. Nothing else here needs confirming, so this
  // is the one adapter with a note.
  note: (home) => ['Codex sandboxes writes. Add this to ~/.codex/config.toml so $clip can reach the store:', '', '  [sandbox_workspace_write]', `  writable_roots = ["${home}"]`].join('\n'),
};

// Codex stores rollouts under ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl.
// Verified against the real on-disk format (session_meta + event_msg lines).
const ROOT = process.env.CODEX_SESSIONS_DIR || join(homedir(), '.codex', 'sessions');

function walkJsonl(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walkJsonl(full, out);
    else if (e.name.endsWith('.jsonl')) out.push(full);
  }
}

export function listSessions() {
  if (!existsSync(ROOT)) return [];
  const files = [];
  walkJsonl(ROOT, files);
  const refs = [];
  for (const path of files) {
    // Session id is the uuid embedded in the filename: rollout-<ts>-<uuid>.jsonl
    const m = path.match(/rollout-.*?-([0-9a-f-]{36})\.jsonl$/);
    const id = m ? m[1] : path;
    let mtimeMs;
    try {
      mtimeMs = statSync(path).mtimeMs;
    } catch {
      continue;
    }
    refs.push({ id, path, mtimeMs });
  }
  return refs;
}

function itemText(item) {
  return (item.content || [])
    .map((b) => (typeof b?.text === 'string' ? b.text : ''))
    .join('')
    .trim();
}

export function parse(ref) {
  const neutral = emptyNeutral(ref.id, name);
  const raw = readFileSync(ref.path, 'utf8');
  // Codex 0.16x logs a conversation as event_msg item_completed items
  // (UserMessage / AgentMessage); older rollouts used user_message /
  // agent_message events. A file can hold both while it's being migrated,
  // so collect each and keep the newer one if it has anything.
  const itemTurns = [];
  const legacyTurns = [];

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }

    if (evt.type === 'session_meta' && evt.payload) {
      // A subagent's own rollout (e.g. `approvals_reviewer = "auto_review"`'s
      // guardian, whose answers are {"risk_level": ...} verdicts) is not a
      // conversation anyone had; with no turns the scanner skips it.
      if (evt.payload.source?.subagent) return neutral;
      neutral.id = evt.payload.id || neutral.id;
      neutral.cwd = evt.payload.cwd || neutral.cwd;
      neutral.projectDir = evt.payload.cwd || neutral.projectDir; // codex resumes against launch cwd
      if (evt.timestamp) neutral.startedAt = evt.timestamp;
      continue;
    }

    if (evt.timestamp) {
      if (!neutral.startedAt) neutral.startedAt = evt.timestamp;
      neutral.endedAt = evt.timestamp;
    }

    if (evt.type === 'event_msg' && evt.payload) {
      const p = evt.payload;
      if (p.type === 'item_completed' && p.item) {
        const role = p.item.type === 'UserMessage' ? 'user' : p.item.type === 'AgentMessage' ? 'assistant' : null;
        const text = role && itemText(p.item);
        if (text) itemTurns.push({ role, text });
      } else if (p.type === 'user_message' && p.message) {
        legacyTurns.push({ role: 'user', text: p.message });
      } else if (p.type === 'agent_message' && p.message) {
        legacyTurns.push({ role: 'assistant', text: p.message });
      }
    } else if (evt.type === 'response_item' && evt.payload) {
      // Tool/function calls → prose summary only.
      const p = evt.payload;
      if (p.type === 'function_call' && p.name) {
        neutral.toolActivity.push(p.name + (p.arguments ? `: ${String(p.arguments).slice(0, 100)}` : ''));
      }
    }
  }

  neutral.turns = itemTurns.length ? itemTurns : legacyTurns;
  return neutral;
}
