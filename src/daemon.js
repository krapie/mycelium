// Barrel re-export — split into src/daemon/cycles.js (cadence/policy: scan →
// organize → tag, smart-organize, digest) and src/daemon/process.js (OS
// process lifecycle: spawn/detach/pidfile), kept as a barrel here so every
// existing importer keeps using './daemon.js' unchanged.
//
// Dropped in the split: the `if (import.meta.url === ...) runDaemon()`
// self-invoking bootstrap this file used to end with. Confirmed via grep
// that daemon.js is never executed directly — spawnDetachedDaemon() spawns
// `cli.js daemon`, not this file — so it was dead code left over from an
// earlier design.
export * from './daemon/cycles.js';
export * from './daemon/process.js';
