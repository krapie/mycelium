// Barrel re-export — store sync across machines via git, split into
// src/sync/git.js (running git, repo setup), src/sync/merge.js (pure merge
// rules for session records) and src/sync/cycle.js (one sync pass), same
// barrel+siblings shape as organize.js/daemon.js.
export * from './sync/git.js';
export * from './sync/merge.js';
export * from './sync/cycle.js';
