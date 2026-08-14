#!/usr/bin/env node
// Run right after the pitch video's handoff (`h`) beat, in a separate
// process from the still-running (or just-quit) pitch-launch.js — seeds one
// more session (demo/pitch-continuation-data.js) depicting the handed-off
// work coming back, then links it to the original via the REAL
// linkContinuation() (src/organize.js barrel), the exact function a genuine
// handoff-and-capture would call (see src/tui/launch.js's run()). This is
// what makes the tape's next beat (relaunching, showing the new session with
// its real [Resumed] badge) actual product mechanics, not a staged screen —
// only the turn CONTENT is hand-authored, same as every other session in
// this dataset.
//
// Usage: MYCELIUM_HOME=/tmp/whatever node demo/seed-pitch-continuation.js <en|ko>

import { randomUUID } from 'node:crypto';
import { allRaw, saveRaw } from '../src/scanner.js';
import { emptyNeutral } from '../src/schema.js';
import { reindex } from '../src/index-db.js';
import { linkContinuation } from '../src/organize.js';
import { PITCH_CONTINUATION } from './pitch-continuation-data.js';

const locale = process.argv[2];
if (locale !== 'en' && locale !== 'ko') {
  console.error('Usage: MYCELIUM_HOME=/tmp/whatever node demo/seed-pitch-continuation.js <en|ko>');
  process.exit(1);
}

// The one real, untouched (not merged/split, and not one of the merge's
// now-superseded originals — mergeSessions() keeps those on disk, just
// marked supersededBy, same as organize/folders.js's own isSuperseded())
// session left in the merge target folder — identified by folder + absence
// of any merge/split lineage, not by a stable id (seed-pitch-demo.js gives
// every session a fresh randomUUID() each run). There must be exactly one;
// anything else means the folder/dataset shape changed and this needs a
// matching update.
const candidates = allRaw().filter(
  (n) =>
    n.folder === PITCH_CONTINUATION.folder &&
    !n.mergedFrom?.length &&
    !n.splitFrom &&
    !n.continuationOf &&
    !n.supersededBy?.length,
);
if (candidates.length !== 1) {
  console.error(
    `Expected exactly 1 untouched session in ${PITCH_CONTINUATION.folder}, found ${candidates.length}. ` +
      'Did seed-pitch-demo.js or the merge/split beat run first?',
  );
  process.exit(1);
}
const target = candidates[0];

const now = new Date().toISOString();
const n = emptyNeutral(randomUUID(), PITCH_CONTINUATION.source);
n.folder = PITCH_CONTINUATION.folder;
n.organizedBy = 'human'; // matches how a real captured continuation lands — see move()'s own convention
n.startedAt = now;
n.endedAt = now;
n.turns = PITCH_CONTINUATION.turns.map((t) => ({ role: t.role, text: t[locale] }));
n.extracted.title = PITCH_CONTINUATION.title[locale];
n.extracted.summary = PITCH_CONTINUATION.summary[locale];
n.extracted.tags = PITCH_CONTINUATION.tags;
n.summarizedTurnCount = n.turns.length;
saveRaw(n);

linkContinuation(n.id, target.id);
reindex();

console.log(`seeded continuation session ${n.id} -> continuationOf ${target.id}`);
