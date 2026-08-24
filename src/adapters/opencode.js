import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { emptyNeutral } from '../schema.js';

export const name = 'opencode';
export const label = 'OpenCode';
export const bin = 'opencode';
export const newArgs = (seed) => (seed ? ['--prompt', seed] : []);
export const resumeArgs = (sessionId) => ['--session', sessionId];

// OpenCode stores everything in one SQLite DB (not per-session files like the
// other adapters) — verified against a real installed opencode (v1.18.20) on
// this machine: session/project/message/part tables, WAL journaling. It uses
// the XDG data dir even on macOS (unlike kiro-cli's native Application
// Support path), so mirror that instead of hardcoding a platform path.
const DB_PATH =
  process.env.OPENCODE_SQLITE_DB || join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'opencode', 'opencode.db');

export function listSessions() {
  if (!existsSync(DB_PATH)) return [];
  let db;
  try {
    db = new DatabaseSync(DB_PATH, { readOnly: true });
  } catch {
    return [];
  }
  try {
    const rows = db.prepare('SELECT id, time_updated FROM session').all();
    return rows.map((row) => ({ id: row.id, path: DB_PATH, mtimeMs: row.time_updated }));
  } catch {
    return []; // schema mismatch across opencode versions — skip rather than crash the whole scan
  } finally {
    db.close();
  }
}

// Prose summary only — never `state.output` or full `input.content`/`input.diff`,
// same rule claude-code.js/codex.js/kiro.js follow for tool activity. Only
// `filePath` is safe to echo verbatim: `command` (bash) and `query`
// (search) can carry secrets a user never typed for Mycelium to keep — a
// `bash` call like `export API_KEY=...` would otherwise land straight in
// toolActivity, get persisted to raw/<id>.json, and get fed to whatever LLM
// autotag/organize calls next. Deliberately narrower here than the other
// three adapters' equivalent summaries (a pre-existing gap there, not
// something this file should also introduce).
function toolTarget(input) {
  return input?.filePath || '';
}

function textOf(parts) {
  return parts
    .filter((p) => p.type === 'text' && p.text)
    .map((p) => p.text)
    .join('\n');
}

export function parse(ref) {
  const neutral = emptyNeutral(ref.id, name);
  const db = new DatabaseSync(ref.path, { readOnly: true });

  try {
    const session = db.prepare('SELECT * FROM session WHERE id = ?').get(ref.id);
    if (!session) return neutral; // gone since listSessions() ran — scanner.js skips 0-turn sessions

    const project = session.project_id ? db.prepare('SELECT * FROM project WHERE id = ?').get(session.project_id) : null;
    neutral.cwd = session.directory || null;
    // project.worktree is the git root; the synthetic 'global' project (sessions
    // launched outside any repo) has worktree '/' — not a usable resume dir.
    neutral.projectDir = (project?.worktree && project.worktree !== '/' ? project.worktree : session.directory) || null;
    if (session.time_created) neutral.startedAt = new Date(session.time_created).toISOString();
    if (session.time_updated) neutral.endedAt = new Date(session.time_updated).toISOString();

    const messages = db.prepare('SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created ASC').all(ref.id);
    const files = new Set();

    for (const row of messages) {
      let msg;
      try {
        msg = JSON.parse(row.data);
      } catch {
        continue;
      }
      const role = msg.role === 'assistant' ? 'assistant' : msg.role === 'user' ? 'user' : null;
      if (!role) continue;

      const partRows = db.prepare('SELECT data FROM part WHERE message_id = ? ORDER BY time_created ASC').all(row.id);
      const parts = [];
      for (const p of partRows) {
        try {
          parts.push(JSON.parse(p.data));
        } catch {
          continue;
        }
      }

      const text = textOf(parts);
      if (text.trim()) neutral.turns.push({ role, text });

      for (const p of parts) {
        if (p.type !== 'tool') continue;
        const input = p.state?.input;
        const toolName = p.tool || 'tool';
        const target = toolTarget(input);
        neutral.toolActivity.push(target ? `${toolName}: ${String(target).slice(0, 120)}` : toolName);
        if ((toolName === 'edit' || toolName === 'write') && input?.filePath) files.add(input.filePath);
      }
    }

    neutral.artifacts.filesChanged = [...files];
  } finally {
    db.close();
  }

  return neutral;
}
