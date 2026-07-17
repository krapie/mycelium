import { homedir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { emptyNeutral } from '../schema.js';

// Claude Code stores sessions under ~/.claude/projects/<encoded-project-dir>/,
// where the folder name is the launch directory with every '/' turned into '-'.
// `claude --resume <id>` resolves against THAT project dir, not the cwd recorded
// inside individual messages — so we recover it from the folder name.
function decodeProjectDir(sessionFilePath) {
  const folder = basename(dirname(sessionFilePath));
  const decoded = folder.replace(/-/g, '/').replace(/\/+/g, '/');
  return decoded;
}

export const name = 'claude-code';

// Claude Code stores one dir per encoded cwd under ~/.claude/projects/, each
// containing <sessionId>.jsonl transcripts. Verified against the real layout.
const ROOT = process.env.CLAUDE_PROJECTS_DIR || join(homedir(), '.claude', 'projects');

export function listSessions() {
  if (!existsSync(ROOT)) return [];
  const refs = [];
  for (const projDir of readdirSync(ROOT)) {
    const full = join(ROOT, projDir);
    let entries;
    try {
      entries = readdirSync(full);
    } catch {
      continue;
    }
    for (const f of entries) {
      if (!f.endsWith('.jsonl')) continue;
      const path = join(full, f);
      let mtimeMs = 0;
      try {
        mtimeMs = statSync(path).mtimeMs;
      } catch {
        continue;
      }
      refs.push({ id: f.replace(/\.jsonl$/, ''), path, mtimeMs });
    }
  }
  return refs;
}

function textFromMessageContent(content) {
  // content may be a string or an array of typed blocks (text/thinking/tool_use/…)
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (block?.type === 'text' && block.text) parts.push(block.text);
  }
  return parts.join('\n');
}

function toolActivityFromContent(content, sink) {
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block?.type === 'tool_use') {
      const name = block.name || 'tool';
      const input = block.input || {};
      // Prose summary only — never the full tool payload.
      const target = input.file_path || input.path || input.command || input.pattern || '';
      sink.push(target ? `${name}: ${String(target).slice(0, 120)}` : name);
    }
  }
}

export function parse(ref) {
  const neutral = emptyNeutral(ref.id, name);
  neutral.projectDir = decodeProjectDir(ref.path);
  const raw = readFileSync(ref.path, 'utf8');
  const lines = raw.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      continue; // skip a corrupt line, keep the rest of the session
    }

    if (evt.cwd && !neutral.cwd) neutral.cwd = evt.cwd;
    if (evt.timestamp) {
      if (!neutral.startedAt) neutral.startedAt = evt.timestamp;
      neutral.endedAt = evt.timestamp;
    }

    if (evt.type === 'user' && evt.message) {
      const text = textFromMessageContent(evt.message.content);
      if (text.trim()) neutral.turns.push({ role: 'user', text });
    } else if (evt.type === 'assistant' && evt.message) {
      const text = textFromMessageContent(evt.message.content);
      if (text.trim()) neutral.turns.push({ role: 'assistant', text });
      toolActivityFromContent(evt.message.content, neutral.toolActivity);
    }
  }

  // Best-effort filesChanged from tool activity referencing paths.
  const files = new Set();
  for (const a of neutral.toolActivity) {
    const m = a.match(/(?:Edit|Write|MultiEdit|NotebookEdit):\s*(\S+)/);
    if (m) files.add(m[1]);
  }
  neutral.artifacts.filesChanged = [...files];

  return neutral;
}
