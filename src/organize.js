// Barrel re-export — organize.js used to be one 595-line file mixing folder
// CRUD, the LLM classification workflow, and merge/split/continuation
// lineage. Split into src/organize/{folders,classify,lineage}.js by
// responsibility (see docs/features.md's architecture notes for why), kept
// as a barrel here so every existing importer keeps using '../organize.js'
// unchanged.
export * from './organize/folders.js';
export * from './organize/classify.js';
export * from './organize/lineage.js';
