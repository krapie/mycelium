// Pure merge rules for a session record (raw/<id>.json) that two machines
// both changed since their last sync. git hands the merge driver the common
// ancestor, ours and theirs (see git.js's registerMergeDrivers()); a line
// merge of pretty-printed JSON can produce invalid JSON or silently mix two
// unrelated edits, so the record is merged field by field instead.
//
// Who writes which fields is what makes this tractable: the transcript only
// ever grows on the machine whose agent produced it, LLM output only comes
// from the worker machine (cycles.js), and the rest are human edits.

// Fields only capture (scan()) writes — taken together from one side, so a
// session never ends up with one machine's turns and the other's endedAt.
const CAPTURE_FIELDS = ['turns', 'toolActivity', 'artifacts', 'startedAt', 'endedAt', '_mtimeMs', 'cwd', 'projectDir'];
// Written by auto-tagging (learn.js) — summarizedTurnCount says how much of
// the transcript `extracted` covers, so the side that saw more wins.
const SUMMARY_FIELDS = ['extracted', 'summarizedTurnCount'];
const PLACEMENT_FIELDS = ['folder', 'organizedBy'];
// Lineage and hand-edited tag lists only accumulate; dropping an entry
// because the other machine didn't have it yet would lose real history.
const UNION_FIELDS = ['mergedFrom', 'supersededBy', 'splitInto', 'continuedTo', 'humanTags', 'humanRemovedTags'];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const time = (n) => Date.parse(n?.updatedAt || '') || 0;

function newer(ours, theirs) {
  return time(theirs) > time(ours) ? theirs : ours;
}

function captureWinner(ours, theirs) {
  const o = ours.turns?.length || 0;
  const t = theirs.turns?.length || 0;
  if (t !== o) return t > o ? theirs : ours;
  return (theirs._mtimeMs || 0) > (ours._mtimeMs || 0) ? theirs : ours;
}

function summaryWinner(ours, theirs) {
  const o = ours.summarizedTurnCount ?? -1;
  const t = theirs.summarizedTurnCount ?? -1;
  if (t !== o) return t > o ? theirs : ours;
  return newer(ours, theirs);
}

// A person's placement beats any automatic one, whichever happened later —
// the same rule organize.js enforces locally with `organizedBy: 'human'`.
function placementWinner(ours, theirs) {
  const oHuman = ours.organizedBy === 'human';
  const tHuman = theirs.organizedBy === 'human';
  if (oHuman !== tHuman) return tHuman ? theirs : ours;
  return newer(ours, theirs);
}

function union(a = [], b = []) {
  const out = [...a];
  for (const x of b) if (!out.some((y) => same(x, y))) out.push(x);
  return out;
}

/**
 * Merge two versions of one session record against their common ancestor.
 * `base` is null when both sides added the file independently (e.g. the
 * first sync of two existing stores). Returns the merged record.
 */
export function mergeSession(base, ours, theirs) {
  const b = base || {};
  const capture = captureWinner(ours, theirs);
  const summary = summaryWinner(ours, theirs);
  const placement = placementWinner(ours, theirs);
  const out = {};
  const keys = new Set([...Object.keys(ours), ...Object.keys(theirs)]);
  for (const k of keys) {
    const o = ours[k];
    const t = theirs[k];
    if (same(o, t)) out[k] = o;
    else if (k in b && same(o, b[k])) out[k] = t;
    else if (k in b && same(t, b[k])) out[k] = o;
    else if (CAPTURE_FIELDS.includes(k)) out[k] = capture[k];
    else if (SUMMARY_FIELDS.includes(k)) out[k] = summary[k];
    else if (PLACEMENT_FIELDS.includes(k)) out[k] = placement[k];
    else if (UNION_FIELDS.includes(k)) out[k] = union(o, t);
    else if (k === 'titleLocked') out[k] = !!(o || t);
    else if (k === 'updatedAt') out[k] = time(theirs) > time(ours) ? t : o;
    else out[k] = newer(ours, theirs)[k];
  }
  // A title a person typed outlives whichever side's auto-summary won above.
  const locked = [ours, theirs].filter((n) => n.titleLocked && n.extracted?.title);
  if (locked.length && out.extracted) {
    const keep = locked.length === 2 ? newer(ours, theirs) : locked[0];
    out.extracted = { ...out.extracted, title: keep.extracted.title };
  }
  return out;
}
