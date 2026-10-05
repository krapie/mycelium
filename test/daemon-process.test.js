import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { useTempHome } from './helpers.js';

useTempHome();

const { installShutdownHandlers } = await import('../src/daemon/process.js');
const { __trackChildForTest, __clearInFlightForTest } = await import('../src/llm.js');

test('the standalone daemon kills in-flight LLM children on SIGTERM before exiting (#139)', () => {
  const proc = new EventEmitter();
  const exits = [];
  const killed = [];
  __trackChildForTest({ kill: (sig) => killed.push(sig) });
  try {
    installShutdownHandlers(proc, (code) => exits.push(code));
    proc.emit('SIGTERM');
    assert.deepEqual(killed, ['SIGTERM']);
    assert.deepEqual(exits, [0]);
  } finally {
    __clearInFlightForTest();
  }
});
