import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { emptyNeutral } from '../schema.js';

export const name = 'codex';

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
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(path).mtimeMs;
    } catch {
      continue;
    }
    refs.push({ id, path, mtimeMs });
  }
  return refs;
}

export function parse(ref) {
  const neutral = emptyNeutral(ref.id, name);
  const raw = readFileSync(ref.path, 'utf8');

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }

    if (evt.type === 'session_meta' && evt.payload) {
      neutral.id = evt.payload.id || neutral.id;
      neutral.cwd = evt.payload.cwd || neutral.cwd;
      if (evt.timestamp) neutral.startedAt = evt.timestamp;
      continue;
    }

    if (evt.timestamp) {
      if (!neutral.startedAt) neutral.startedAt = evt.timestamp;
      neutral.endedAt = evt.timestamp;
    }

    if (evt.type === 'event_msg' && evt.payload) {
      const p = evt.payload;
      if (p.type === 'user_message' && p.message) {
        neutral.turns.push({ role: 'user', text: p.message });
      } else if (p.type === 'agent_message' && p.message) {
        neutral.turns.push({ role: 'assistant', text: p.message });
      }
    } else if (evt.type === 'response_item' && evt.payload) {
      // Tool/function calls → prose summary only.
      const p = evt.payload;
      if (p.type === 'function_call' && p.name) {
        neutral.toolActivity.push(p.name + (p.arguments ? `: ${String(p.arguments).slice(0, 100)}` : ''));
      }
    }
  }

  return neutral;
}
