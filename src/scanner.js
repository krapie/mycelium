import { join } from 'node:path';
import { writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { ensureDirs, RAW_DIR } from './paths.js';
import * as claudeCode from './adapters/claude-code.js';
import * as codex from './adapters/codex.js';
import * as kiro from './adapters/kiro.js';
import { META_MARKER } from './llm.js';
import { loadConfig } from './config.js';

const ADAPTERS = [claudeCode, codex, kiro];

function rawPath(id) {
  // session ids are uuids / safe filenames already, but guard anyway
  return join(RAW_DIR, `${id.replace(/[^\w.-]/g, '_')}.json`);
}

// Mycelium runs its own LLM calls via `claude -p` / `codex exec`, which the
// agents then store as sessions — capturing those back would pollute the store
// with the tagging/digest/knowledge prompts. llm.js now stamps every one of
// its own prompts with META_MARKER, which is the reliable signal. The string
// list below only exists to retroactively purge older prompt wordings (from
// before the marker existed) that already got captured as real sessions —
// don't rely on it for new detections, it drifts every time a prompt is
// rewritten (it already has, twice).
const META_SIGNATURES = [
  '실제로 수행된 작업(task) 관점에서',
  '다음은 AI 코딩/업무 세션의 대화 기록',
  '인수인계 메모처럼 서사형으로',
  '"프로젝트 지식"을 정리해라',
  '출력 형식:\n{"tags"',
  '실질 내용(알맹이)',
  '출력 형식:\n{"title"',
];
function isMyceliumMeta(neutral) {
  const firstUser = neutral.turns.find((t) => t.role === 'user')?.text || '';
  return firstUser.includes(META_MARKER) || META_SIGNATURES.some((sig) => firstUser.includes(sig));
}

export function loadRaw(id) {
  const p = rawPath(id);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function saveRaw(neutral) {
  ensureDirs();
  writeFileSync(rawPath(neutral.id), JSON.stringify(neutral, null, 2));
}

/** Remove a session from Mycelium's own store. The source agent log is untouched. */
export function deleteRaw(id) {
  const p = rawPath(id);
  if (existsSync(p)) rmSync(p);
}

/**
 * Scan every adapter's session store, parse new/changed sessions into the
 * neutral schema, and write them to raw/. Preserves any `extracted`/`folder`/
 * `organizedBy` already stored (those are owned by later lifecycle stages, not
 * by capture). Returns a summary { scanned, imported, skipped, failed }.
 */
/** Remove already-stored raw files that are Mycelium's own LLM calls. */
export function purgeMeta() {
  ensureDirs();
  let removed = 0;
  for (const f of readdirSync(RAW_DIR)) {
    if (!f.endsWith('.json')) continue;
    const p = join(RAW_DIR, f);
    try {
      const n = JSON.parse(readFileSync(p, 'utf8'));
      if (isMyceliumMeta(n)) {
        rmSync(p);
        removed++;
      }
    } catch {
      /* skip */
    }
  }
  return removed;
}

export function scan({ onImport } = {}) {
  ensureDirs();
  purgeMeta();
  const excluded = new Set(loadConfig().excludedSessionIds || []);
  let scanned = 0;
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const adapter of ADAPTERS) {
    let refs;
    try {
      refs = adapter.listSessions();
    } catch (err) {
      console.error(`[${adapter.name}] listSessions failed: ${err.message}`);
      continue;
    }

    for (const ref of refs) {
      scanned++;
      // A session the user explicitly deleted (organize.deleteSession) stays
      // deleted even though its source log is still on disk — otherwise the
      // very next scan would just re-import it.
      if (excluded.has(ref.id)) {
        skipped++;
        continue;
      }
      const existing = loadRaw(ref.id);
      // Skip if we already captured this session and the file hasn't changed.
      if (existing && existing._mtimeMs === ref.mtimeMs) {
        skipped++;
        continue;
      }

      let neutral;
      try {
        neutral = adapter.parse(ref);
      } catch (err) {
        failed++;
        console.error(`[${adapter.name}] parse failed for ${ref.id}: ${err.message}`);
        continue;
      }

      if (neutral.turns.length === 0 || isMyceliumMeta(neutral)) {
        skipped++; // empty session, or Mycelium's own LLM call — not real work
        continue;
      }

      // Carry forward downstream-owned fields on re-import.
      if (existing) {
        neutral.extracted = existing.extracted || neutral.extracted;
        neutral.folder = existing.folder ?? neutral.folder;
        neutral.organizedBy = existing.organizedBy || neutral.organizedBy;
        neutral.continuationOf = existing.continuationOf ?? neutral.continuationOf;
        neutral.continuedTo = existing.continuedTo ?? neutral.continuedTo;
      }
      neutral._mtimeMs = ref.mtimeMs;

      writeFileSync(rawPath(neutral.id), JSON.stringify(neutral, null, 2));
      imported++;
      if (onImport) onImport(neutral);
    }
  }

  return { scanned, imported, skipped, failed };
}

export function allRaw() {
  ensureDirs();
  const out = [];
  for (const f of readdirSync(RAW_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(readFileSync(join(RAW_DIR, f), 'utf8')));
    } catch {
      /* skip corrupt raw file */
    }
  }
  return out;
}

/**
 * Resolve a session by exact id or unique prefix — `list`/`search` only ever
 * print the 8-char prefix, so CLI commands taking a session id need to accept
 * that too, not just the full uuid.
 */
export function findSession(idOrPrefix) {
  const exact = loadRaw(idOrPrefix);
  if (exact) return { ok: true, session: exact };
  const matches = allRaw().filter((n) => n.id.startsWith(idOrPrefix));
  if (matches.length === 0) return { ok: false, error: `no session matching "${idOrPrefix}"` };
  if (matches.length > 1) {
    const hint = matches
      .slice(0, 5)
      .map((n) => n.id.slice(0, 8))
      .join(', ');
    return {
      ok: false,
      error: `ambiguous prefix "${idOrPrefix}" — ${matches.length} matches (${hint}${matches.length > 5 ? ', …' : ''}); use more characters`,
    };
  }
  return { ok: true, session: matches[0] };
}
