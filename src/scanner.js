import { join } from 'node:path';
import { writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { ensureDirs, RAW_DIR } from './paths.js';
import { ADAPTERS } from './adapters/index.js';
import { META_MARKER } from './llm.js';
import { loadConfig } from './config.js';

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
  const cfg = loadConfig();
  const excluded = new Set(cfg.excludedSessionIds || []);
  const archiveDays = Number(cfg.archiveOlderThanDays) || 0;
  const archiveCutoff = Date.now() - archiveDays * 86400000;
  let scanned = 0;
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  // ADAPTERS read from each agent's REAL global store (~/.claude, ~/.codex,
  // ~/.kiro, plus OpenCode's own opencode.db — see adapters/index.js),
  // completely unaffected by MYCELIUM_HOME.
  // Wrong for BOTH tutorial-launch paths, not just `mycelium demo`'s
  // isolated walkthrough: first-run onboarding runs against the real
  // ~/.mycelium, and without a guard pressing scan there (directly or via
  // the `.` menu — see tutorial.js) would import the user's actual real
  // content into the very same batch injectDemoSessions() is about to add,
  // both landing in one indistinguishable reveal. cli.js's `demo` command
  // sets MYCELIUM_DEMO_MODE on its child process alongside MYCELIUM_HOME;
  // tutorial.js's startTutorial() sets it too, for either flow, for the
  // tutorial's whole lifetime (see that function's own comment) — skip the
  // real adapters entirely when it's set, rather than trying to scope by
  // MYCELIUM_HOME's path.
  const skipRealAdapters = process.env.MYCELIUM_DEMO_MODE === '1';
  for (const adapter of skipRealAdapters ? [] : ADAPTERS) {
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
      // One-time migration: the claude-code adapter's `name` (and every
      // session's `source`) used to be 'claude-code', renamed to 'claude' to
      // match what AGENTS/binFor/sourceColor always keyed on. Sessions
      // captured before that rename would otherwise keep the stale value
      // forever — the skip-if-unchanged check right below means their
      // underlying transcript never gets re-parsed. Cheap field rewrite, not
      // a re-parse, and a no-op after the first pass on a given session.
      if (existing?.source === 'claude-code') {
        existing.source = 'claude';
        writeFileSync(rawPath(existing.id), JSON.stringify(existing, null, 2));
      }
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

      // Carry forward downstream-owned fields on re-import. mergedFrom/
      // splitFrom/supersededBy are split.js/organize.js's lineage flags —
      // missing them here was a real bug: a session that's still actively
      // growing (its own agent log keeps changing) gets rescanned on every
      // scan cycle, and without this, each rescan silently reset supersededBy
      // back to [], un-hiding an already-split/merged-away original.
      if (existing) {
        neutral.extracted = existing.extracted || neutral.extracted;
        neutral.folder = existing.folder ?? neutral.folder;
        neutral.organizedBy = existing.organizedBy || neutral.organizedBy;
        neutral.continuationOf = existing.continuationOf ?? neutral.continuationOf;
        neutral.continuedTo = existing.continuedTo ?? neutral.continuedTo;
        neutral.mergedFrom = existing.mergedFrom?.length ? existing.mergedFrom : neutral.mergedFrom;
        neutral.splitFrom = existing.splitFrom ?? neutral.splitFrom;
        neutral.supersededBy = existing.supersededBy?.length ? existing.supersededBy : neutral.supersededBy;
        neutral.splitInto = existing.splitInto?.length ? existing.splitInto : neutral.splitInto;
        // Also queued-suggestion + classification bookkeeping — without this,
        // an actively-growing session (its own agent log keeps changing, so
        // it gets reparsed on every scan cycle) would silently lose a
        // not-yet-reviewed smart-organize suggestion, or forget it was
        // already classified and get re-sent to the LLM every cycle.
        neutral.suggestedFolder = existing.suggestedFolder ?? neutral.suggestedFolder;
        neutral.suggestedReason = existing.suggestedReason ?? neutral.suggestedReason;
        neutral.lastClassifiedAt = existing.lastClassifiedAt ?? neutral.lastClassifiedAt;
        // Same reasoning — a title a human deliberately set (setContent())
        // must survive re-scans, and losing summarizedTurnCount would make
        // tagAll() treat an already-tracked session as never-tracked again
        // (harmless — see tagAll()'s doc comment — but still wrong state).
        neutral.titleLocked = existing.titleLocked ?? neutral.titleLocked;
        neutral.summarizedTurnCount = existing.summarizedTurnCount ?? neutral.summarizedTurnCount;
      }
      // First-time capture of an already-old session: file it straight into
      // _archive rather than New/unfiled. _archive is already hidden from
      // New/Root/calendar (index-db.js/data.js) and skipped by o/a
      // (classify.js/learn.js), so this keeps a large historical backlog out
      // of the triage flow while still capturing it losslessly. Deliberately
      // gated on `!existing` (first import only) and folder==null (never
      // organized): an already-stored session keeps whatever folder the
      // carry-forward block above restored, so this never retroactively
      // archives sessions already sitting in New — only newly discovered ones.
      // Recency = last activity (endedAt||startedAt), same basis the calendar
      // uses (index-db.js's sessionCountsByDay()).
      if (!existing && archiveDays > 0 && neutral.folder == null && neutral.organizedBy !== 'human') {
        const last = Date.parse(neutral.endedAt || neutral.startedAt || '');
        if (Number.isFinite(last) && last < archiveCutoff) neutral.folder = '_archive';
      }
      neutral._mtimeMs = ref.mtimeMs;

      writeFileSync(rawPath(neutral.id), JSON.stringify(neutral, null, 2));
      imported++;
      if (onImport) onImport(neutral);
    }
  }

  return { scanned, imported, skipped, failed };
}

/**
 * Re-apply the recency archive threshold to the *existing* auto-archived
 * backlog. scan()'s own archiving is first-import-only (it never revisits a
 * stored session), so changing `archiveOlderThanDays` after a big first scan
 * has no retroactive effect on its own — this is the reconciliation pass that
 * does. Only touches auto-owned sessions currently in `_archive` or unfiled
 * (New); a human placement (`organizedBy: 'human'`) or a real-folder
 * placement is never disturbed. `days` defaults to the current config value.
 * Bidirectional: an auto-archived session now inside the window comes back to
 * New (folder null); an unfiled auto session now past the window gets
 * archived. Caller is responsible for reindex() afterwards (matches scan()).
 */
export function reevaluateArchive({ days } = {}) {
  ensureDirs();
  const archiveDays = days ?? (Number(loadConfig().archiveOlderThanDays) || 0);
  const cutoff = Date.now() - archiveDays * 86400000;
  const inArchive = (f) => f === '_archive' || (!!f && f.startsWith('_archive/'));
  let archived = 0;
  let unarchived = 0;
  for (const n of allRaw()) {
    if (n.organizedBy === 'human') continue;
    const wasArchived = inArchive(n.folder);
    if (!wasArchived && n.folder != null) continue; // in a real (auto) folder — leave it
    const last = Date.parse(n.endedAt || n.startedAt || '');
    const shouldArchive = archiveDays > 0 && Number.isFinite(last) && last < cutoff;
    if (wasArchived && !shouldArchive) {
      n.folder = null;
      saveRaw(n);
      unarchived++;
    } else if (!wasArchived && shouldArchive) {
      n.folder = '_archive';
      saveRaw(n);
      archived++;
    }
  }
  return { archived, unarchived };
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
