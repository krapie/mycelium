import { findSession } from '../scanner.js';
import { reindex } from '../index-db.js';
import {
  mkdir,
  move,
  tag,
  reviewablePlacements,
  applyPlacements,
  clearSuggestions,
  listTreeDirs,
  unmerge,
} from '../organize.js';
import { unsplit } from '../split.js';
import { fail, parseFlags, resolveSessionId } from './util.js';
import { loadConfig, saveConfig, organizeLimit, parseLimit } from '../config.js';

export async function organizeCmd(args) {
  // Always content-based classification; `--smart` is still accepted
  // (harmlessly ignored) for anyone with it in a saved script.
  const { flags } = parseFlags(args);
  if (flags['set-limit'] !== undefined) {
    const n = parseLimit(flags['set-limit']);
    if (!n) return fail('Usage: mycelium organize --set-limit <positive number>');
    saveConfig({ ...loadConfig(), organizeLimit: n });
    console.log(`organize limit set to ${n} session(s) per run`);
    return;
  }
  if (flags.limit !== undefined && !parseLimit(flags.limit)) return fail('--limit needs a positive number');
  // One limit for every step of this run (#167): the saved organizeLimit,
  // or --limit for just this run.
  const limit = parseLimit(flags.limit) ?? organizeLimit();
  // Reuses whatever the daemon already queued (smartOrganizeCycle in
  // daemon.js) instead of recomputing — instant when the daemon's been
  // doing the work in the background. Nothing moves until --apply.
  const res = await reviewablePlacements({
    folder: flags.folder || undefined,
    limit,
    onEvent: (e) => {
      if (e.type === 'queue-limited') console.log(`showing ${e.shown} of ${e.queued} queued suggestion(s) — --apply files these, then run again for the next batch`);
      else if (e.type === 'batch-limited') console.log(`organizing ${e.limit} of ${e.total} session(s) this run (limit ${e.limit}; run again for the next batch)`);
      else if (e.type === 'summarizing') console.log(`summarizing ${e.count} session(s) first…`);
      else if (e.type === 'summarize-error') console.log(`  ! ${e.error.message}`);
      else if (e.type === 'summarized') console.log(`  + ${e.id.slice(0, 8)}`);
      else if (e.type === 'classifying') {
        reindex();
        console.log('classifying…');
      } else if (e.type === 'batch' && e.total > 1) console.log(`  batch ${e.done}/${e.total}`);
    },
  });
  if (!res.ok) return fail(res.error);
  const placements = res.placements;
  if (!placements.length) {
    console.log('no confident placements found');
    return;
  }
  const existingDirs = new Set(listTreeDirs());
  for (const p of placements) {
    const badge = p.folder && !existingDirs.has(p.folder) ? ' (new folder)' : '';
    console.log(`${p.id.slice(0, 8)}  → ${p.folder || '(no match, stays in _inbox)'}${badge}${p.reason ? `  — ${p.reason}` : ''}`);
  }
  if (flags.apply) {
    const applied = applyPlacements(placements);
    clearSuggestions(placements.map((p) => p.id));
    reindex();
    console.log(`\napplied ${applied} placements`);
  } else {
    const matched = placements.filter((p) => p.folder).length;
    console.log(`\n${matched} suggested — re-run with --apply to file them`);
  }
}

export function mkdirCmd(args) {
  const [folder] = args;
  if (!folder) return fail('Usage: mycelium mkdir <folder-path>');
  console.log(`created ${mkdir(folder)}`);
}

export function mvCmd(args) {
  const [idOrPrefix, folder] = args;
  if (!idOrPrefix) return fail('Usage: mycelium mv <sessionId|prefix> <folder-path>');
  const sessionId = resolveSessionId(idOrPrefix);
  const res = move(sessionId, folder || null);
  if (!res.ok) return fail(res.error);
  reindex();
  console.log(`moved ${sessionId.slice(0, 8)} → ${res.session.folder || '_inbox'} (human)`);
}

export function tagCmd(args) {
  const [idOrPrefix, ...rest] = args;
  if (!idOrPrefix) return fail('Usage: mycelium tag <sessionId|prefix> +tag -tag');
  const sessionId = resolveSessionId(idOrPrefix);
  const add = rest.filter((t) => t.startsWith('+')).map((t) => t.slice(1));
  const remove = rest.filter((t) => t.startsWith('-')).map((t) => t.slice(1));
  const res = tag(sessionId, add, remove);
  if (!res.ok) return fail(res.error);
  reindex();
  console.log(`${sessionId.slice(0, 8)} tags: ${res.session.extracted.tags.join(', ') || '(none)'} (human)`);
}

export function unmergeCmd(args) {
  const { positional } = parseFlags(args);
  const idOrPrefix = positional[0];
  if (!idOrPrefix) return fail('Usage: mycelium unmerge <sessionId|prefix>');
  const found = findSession(idOrPrefix);
  if (!found.ok) return fail(found.error);
  const res = unmerge(found.session.id);
  if (!res.ok) return fail(res.error);
  reindex();
  console.log(`unmerged — restored ${res.restored.length} original session(s)`);
}

export function unsplitCmd(args) {
  const { positional } = parseFlags(args);
  const idOrPrefix = positional[0];
  if (!idOrPrefix) return fail('Usage: mycelium unsplit <sessionId|prefix>');
  const found = findSession(idOrPrefix);
  if (!found.ok) return fail(found.error);
  const res = unsplit(found.session.id);
  if (!res.ok) return fail(res.error);
  reindex();
  console.log(`unsplit — removed ${res.removed.length} split piece(s)`);
}
