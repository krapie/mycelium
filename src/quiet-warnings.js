// Imported first by cli.js, ahead of anything that loads node:sqlite. On
// Node 22 that module emits "ExperimentalWarning: SQLite is an experimental
// feature" on every command — the first thing a user saw after
// `mycelium scan` (#147). Only that one warning is dropped; every other
// warning still reaches Node's own handlers.
const handlers = process.listeners('warning');
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name === 'ExperimentalWarning' && /SQLite/i.test(warning.message)) return;
  for (const handler of handlers) handler(warning);
});
