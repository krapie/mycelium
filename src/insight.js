// Barrel re-export — split into src/insight/{digest,knowledge}.js by
// responsibility (digest generation vs. knowledge extraction/review, the
// `d` vs. `k` distinction — see knowledge.js's foldersActiveOn() comment),
// kept as a barrel so every existing importer keeps using '../insight.js'
// unchanged. Same pattern as organize.js/daemon.js's own barrel+siblings.
export * from './insight/digest.js';
export * from './insight/knowledge.js';
