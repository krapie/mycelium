import { join } from 'node:path';
import { writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { ensureDirs, RAW_DIR } from './paths.js';
import * as claudeCode from './adapters/claude-code.js';
import * as codex from './adapters/codex.js';

const ADAPTERS = [claudeCode, codex];

function rawPath(id) {
  // session ids are uuids / safe filenames already, but guard anyway
  return join(RAW_DIR, `${id.replace(/[^\w.-]/g, '_')}.json`);
}

// Mycelium runs its own LLM calls via `claude -p` / `codex exec`, which the
// agents then store as sessions — capturing those back would pollute the store
// with the tagging/digest/knowledge prompts. Detect and skip them.
const META_SIGNATURES = [
  '실제로 수행된 작업(task) 관점에서',
  '다음은 AI 코딩/업무 세션의 대화 기록',
  '인수인계 메모처럼 서사형으로',
  '"프로젝트 지식"을 정리해라',
  '출력 형식:\n{"tags"',
];
function isMyceliumMeta(neutral) {
  const firstUser = neutral.turns.find((t) => t.role === 'user')?.text || '';
  return META_SIGNATURES.some((sig) => firstUser.includes(sig));
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
