import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { emptyNeutral } from '../schema.js';

export const name = 'kiro';
export const label = 'Kiro';
export const bin = 'kiro-cli';
export const newArgs = (seed) => ['chat', ...(seed ? [seed] : [])];
export const resumeArgs = (sessionId) => ['chat', '--resume-id', sessionId];

// `kiro-cli chat "<prompt>" --no-interactive` runs one prompt to completion
// and exits, printing the reply to stdout (verified against kiro-cli 2.14.1
// on this machine — issue #86). `--trust-tools=` (trust nothing) stops an
// unattended meta-call from executing any tool — the same lock-down
// codex.js gets from its read-only sandbox. `--wrap never` keeps a long
// JSON reply from being hard-wrapped mid-token (a pipe auto-detects to this
// anyway, but be explicit). Kiro has no structured-output mode for chat: it
// prints RENDERED terminal text (ANSI colour codes, a leading "> " speaker
// marker), which llm.js's extractText() strips.
const MODEL = process.env.MYCELIUM_KIRO_MODEL || 'claude-haiku-4.5';
export const headlessArgs = (prompt) => [
  'chat',
  prompt,
  '--no-interactive',
  '--wrap',
  'never',
  '--trust-tools=',
  '--model',
  MODEL,
];

// Kiro CLI has three on-disk formats, verified against a real installed
// kiro-cli (v2.13.0):
//   v2 (current, live): SQLite conversations_v2(key, conversation_id, value,
//     created_at, updated_at) — key is the launch cwd, timestamps epoch ms.
//   v1 (legacy): same DB, conversations(key, value) — no timestamps, one row per cwd.
//   v3 (JSONL sidecar, only seen as an empty stub, kept best-effort):
//     ~/.kiro/sessions/cli/<uuid>.json + <uuid>.jsonl.
const SESSIONS_DIR = process.env.KIRO_SESSIONS_DIR || join(homedir(), '.kiro', 'sessions', 'cli');
const SQLITE_CANDIDATES = [
  process.env.KIRO_SQLITE_DB,
  join(homedir(), 'Library', 'Application Support', 'kiro-cli', 'data.sqlite3'), // macOS
  join(homedir(), '.local', 'share', 'kiro-cli', 'data.sqlite3'), // Linux (undocumented, not verified)
].filter(Boolean);

function findSqliteDb() {
  return SQLITE_CANDIDATES.find((p) => existsSync(p)) || null;
}

function listJsonlSessions() {
  if (!existsSync(SESSIONS_DIR)) return [];
  const refs = [];
  for (const f of readdirSync(SESSIONS_DIR)) {
    if (!f.endsWith('.json')) continue;
    const metaPath = join(SESSIONS_DIR, f);
    let meta;
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    } catch {
      continue;
    }
    const jsonlPath = metaPath.replace(/\.json$/, '.jsonl');
    let mtimeMs;
    try {
      mtimeMs = statSync(jsonlPath).mtimeMs;
    } catch {
      continue; // no companion .jsonl — nothing to parse
    }
    if (mtimeMs === 0) continue;
    refs.push({
      id: meta.session_id || f.replace(/\.json$/, ''),
      path: jsonlPath,
      mtimeMs,
      _kind: 'jsonl',
      _cwd: meta.cwd || null,
      _createdAt: meta.created_at || null,
      _updatedAt: meta.updated_at || null,
    });
  }
  return refs;
}

function listSqliteSessions() {
  const dbPath = findSqliteDb();
  if (!dbPath) return [];
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return [];
  }
  const refs = [];
  try {
    const rows = db.prepare('SELECT key, conversation_id, value, created_at, updated_at FROM conversations_v2').all();
    for (const row of rows) {
      refs.push({
        id: row.conversation_id,
        path: dbPath,
        mtimeMs: row.updated_at,
        _kind: 'sqlite-v2',
        _cwd: row.key,
        _createdMs: row.created_at,
        _updatedMs: row.updated_at,
        _rawValue: row.value,
      });
    }
  } catch {
    /* conversations_v2 missing/renamed in this kiro-cli version — skip */
  }
  try {
    const rows = db.prepare('SELECT key, value FROM conversations').all();
    for (const row of rows) {
      refs.push({
        id: `v1:${row.key}`,
        path: dbPath,
        mtimeMs: 0, // v1 rows carry no timestamp — treat as immutable once imported
        _kind: 'sqlite-v1',
        _cwd: row.key,
        _rawValue: row.value,
      });
    }
  } catch {
    /* legacy table absent — fine, nothing to migrate */
  }
  db.close();
  return refs;
}

export function listSessions() {
  const jsonl = listJsonlSessions();
  const seen = new Set(jsonl.map((r) => r.id));
  const sqlite = listSqliteSessions().filter((r) => !seen.has(r.id));
  return [...jsonl, ...sqlite];
}

// Prose summary only — never the full tool payload (same rule claude-code.js
// and codex.js follow).
function toolUseSummary(tu) {
  const names = (tu.tool_uses || []).map((t) => {
    const args = t.args ? `: ${JSON.stringify(t.args).slice(0, 120)}` : '';
    return `${t.name || 'tool'}${args}`;
  });
  return names;
}

function parseSqliteHistory(neutral, ref) {
  neutral.cwd = ref._cwd;
  neutral.projectDir = ref._cwd;
  if (ref._createdMs) neutral.startedAt = new Date(ref._createdMs).toISOString();
  if (ref._updatedMs) neutral.endedAt = new Date(ref._updatedMs).toISOString();

  let data;
  try {
    data = JSON.parse(ref._rawValue);
  } catch {
    return; // corrupt row — leave neutral empty, scanner.js skips 0-turn sessions
  }

  for (const entry of data.history || []) {
    const userContent = entry.user?.content || {};
    if (userContent.Prompt?.prompt) {
      neutral.turns.push({ role: 'user', text: userContent.Prompt.prompt });
    }
    // userContent.ToolUseResults is a synthetic continuation the CLI injects
    // after a tool call, not something the human typed — skip it.

    const assistant = entry.assistant;
    if (!assistant || typeof assistant !== 'object') continue;
    if (assistant.Response?.content) {
      neutral.turns.push({ role: 'assistant', text: assistant.Response.content });
    } else if (assistant.content?.Text) {
      // Older (v1-style) shape, seen in the reference community tool's notes.
      neutral.turns.push({ role: 'assistant', text: assistant.content.Text });
    } else if (assistant.ToolUse) {
      const tu = assistant.ToolUse;
      if (tu.content) neutral.turns.push({ role: 'assistant', text: tu.content });
      neutral.toolActivity.push(...toolUseSummary(tu));
    }
  }
}

function parseJsonl(neutral, ref) {
  neutral.cwd = ref._cwd;
  neutral.projectDir = ref._cwd;
  if (ref._createdAt) neutral.startedAt = ref._createdAt;
  if (ref._updatedAt) neutral.endedAt = ref._updatedAt;

  const raw = readFileSync(ref.path, 'utf8');
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    if (evt.kind !== 'Prompt' && evt.kind !== 'AssistantMessage') continue;
    const blocks = evt.data?.content;
    if (!Array.isArray(blocks)) continue;
    const textBlock = blocks.find((b) => b?.kind === 'text');
    if (!textBlock?.data) continue;
    neutral.turns.push({ role: evt.kind === 'Prompt' ? 'user' : 'assistant', text: textBlock.data });
  }
}

export function parse(ref) {
  const neutral = emptyNeutral(ref.id, name);
  if (ref._kind === 'jsonl') parseJsonl(neutral, ref);
  else parseSqliteHistory(neutral, ref);
  return neutral;
}
