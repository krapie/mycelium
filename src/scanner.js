import { join } from 'node:path';
import { writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { ensureDirs, RAW_DIR } from './paths.js';
import * as claudeCode from './adapters/claude-code.js';

const ADAPTERS = [claudeCode];

function rawPath(id) {
  // session ids are uuids / safe filenames already, but guard anyway
  return join(RAW_DIR, `${id.replace(/[^\w.-]/g, '_')}.json`);
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

/**
 * Scan every adapter's session store, parse new/changed sessions into the
 * neutral schema, and write them to raw/. Preserves any `extracted`/`folder`/
 * `organizedBy` already stored (those are owned by later lifecycle stages, not
 * by capture). Returns a summary { scanned, imported, skipped, failed }.
 */
export function scan({ onImport } = {}) {
  ensureDirs();
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

      if (neutral.turns.length === 0) {
        skipped++; // empty/meta-only session, nothing worth keeping
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
