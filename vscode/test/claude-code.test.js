'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { isSessionId, isClaudeSession, claudeTarget, forWindow, PANEL_COMMAND, EXT_ID } = require('../src/claude-code.js');

const UUID = '3f2a9c1e-5b7d-4e8a-9c3b-1a2b3c4d5e6f';

test('only a real session id is sent to Claude Code', () => {
  assert.equal(isSessionId(UUID), true);
  assert.equal(isSessionId(UUID.toUpperCase()), true);
  for (const bad of ['', undefined, null, 'abc12345', UUID + 'x', `../${UUID}`, 'merge-1234']) assert.equal(isSessionId(bad), false, String(bad));
});

test('a Claude session is one Claude Code recorded — not a merge/split product, backlog note, or other agent', () => {
  assert.equal(isClaudeSession({ id: UUID, source: 'claude' }), true);
  assert.equal(isClaudeSession({ id: UUID, source: 'claude-code' }), true);
  assert.equal(isClaudeSession({ id: UUID, source: 'codex' }), false);
  assert.equal(isClaudeSession({ id: UUID, source: 'claude', mergedFrom: ['a', 'b'] }), false);
  assert.equal(isClaudeSession({ id: UUID, source: 'claude', splitFrom: 'x' }), false);
  assert.equal(isClaudeSession({ id: UUID, source: 'claude', kind: 'backlog' }), false);
  assert.equal(isClaudeSession({ id: 'not-a-uuid', source: 'claude' }), false);
});

test('auto follows the Claude Code extension\'s own choice; panel/terminal force one; others and a missing extension always get a terminal', () => {
  const t = (o) => claudeTarget({ agentKey: 'claude', installed: true, useTerminal: false, ...o });
  assert.equal(t({}), 'panel');
  assert.equal(t({ mode: 'auto', useTerminal: true }), 'terminal');
  assert.equal(t({ mode: 'panel', useTerminal: true }), 'panel');
  assert.equal(t({ mode: 'terminal' }), 'terminal');
  assert.equal(t({ installed: false, mode: 'panel' }), 'terminal');
  assert.equal(t({ agentKey: 'codex', mode: 'panel' }), 'terminal');
});

test('a panel request is kept only in a window that has the session\'s project open', () => {
  const l = { cwd: '/p', bin: 'claude', args: [], key: 'claude', panel: { sessionId: UUID } };
  assert.equal(forWindow(l, { hasProject: true }), l);
  const elsewhere = forWindow(l, { hasProject: false });
  assert.equal(elsewhere.panel, undefined);
  assert.deepEqual([elsewhere.cwd, elsewhere.bin], ['/p', 'claude'], 'the terminal fallback keeps everything it needs');
  assert.equal(forWindow({ cwd: '/p', bin: 'x', args: [] }, { hasProject: false }).panel, undefined);
});

// ---- openLaunch, against a stand-in for the editor
const calls = { exec: [], warn: [], errors: [], terminals: [], activated: 0 };
const state = { installed: true, activateFails: null, execFails: null, settings: {} };
const fake = {
  extensions: { getExtension: (id) => (state.installed && id === EXT_ID ? { packageJSON: { version: '2.1.296' }, isActive: true, activate: async () => { calls.activated++; calls.exec.push('activate'); if (state.activateFails) throw state.activateFails; } } : undefined) },
  commands: { executeCommand: async (...a) => { calls.exec.push(a); if (state.execFails) throw state.execFails; } },
  workspace: { getConfiguration: (section) => ({ get: (k) => state.settings[`${section}.${k}`] }) },
  window: {
    showWarningMessage: (m) => calls.warn.push(m),
    showErrorMessage: (m) => calls.errors.push(m),
    createTerminal: (o) => { const t = { o, sent: [], show() {}, sendText(x) { t.sent.push(x); } }; calls.terminals.push(t); return t; },
  },
  ThemeIcon: class {}, ThemeColor: class {}, env: { shell: '/bin/zsh' },
};
const orig = Module._load;
Module._load = function (request, ...rest) { return request === 'vscode' ? fake : orig.call(this, request, ...rest); };
const { openLaunch, panelWanted } = require('../src/open-session.js');
Module._load = orig;

const reset = () => { calls.exec.length = calls.warn.length = calls.errors.length = calls.terminals.length = 0; calls.activated = 0; Object.assign(state, { installed: true, activateFails: null, execFails: null, settings: {} }); };
const launch = (over = {}) => ({ name: 'n', cwd: '/p', bin: 'claude', args: ['--resume', UUID], key: 'claude', ...over });

test('a panel launch activates the Claude Code extension first, then opens the session in its panel; no terminal', async () => {
  reset();
  await openLaunch(launch({ panel: { sessionId: UUID } }));
  assert.deepEqual(calls.exec, ['activate', [PANEL_COMMAND, UUID, undefined]]);
  assert.equal(calls.terminals.length, 0);
});

test('a handoff opens a new conversation with the prompt', async () => {
  reset();
  await openLaunch(launch({ args: [], panel: { prompt: 'continue the login work' } }));
  assert.deepEqual(calls.exec.at(-1), [PANEL_COMMAND, undefined, 'continue the login work']);
});

test('a panel request that fails (extension throws) falls back to the terminal, and says so', async () => {
  reset();
  state.execFails = new Error('boom');
  await openLaunch(launch({ panel: { sessionId: UUID } }));
  assert.equal(calls.terminals.length, 1);
  assert.equal(calls.terminals[0].sent[0], `claude --resume ${UUID}`);
  assert.match(calls.warn[0], /Claude Code panel.*boom.*terminal/);
});

test('a session id Claude Code would ignore never reaches it', async () => {
  reset();
  await openLaunch(launch({ panel: { sessionId: 'merge-123' } }));
  assert.equal(calls.exec.filter((c) => c !== 'activate').length, 0);
  assert.equal(calls.terminals.length, 1);
});

test('the receiving window decides: no extension, useTerminal, or openIn=terminal all mean a terminal', async () => {
  reset(); state.installed = false;
  await openLaunch(launch({ panel: { sessionId: UUID } }));
  assert.equal(calls.terminals.length, 1);

  reset(); state.settings['claudeCode.useTerminal'] = true;
  await openLaunch(launch({ panel: { sessionId: UUID } }));
  assert.equal(calls.terminals.length, 1);

  reset(); state.settings['mycelium.claudeCode.openIn'] = 'terminal';
  await openLaunch(launch({ panel: { sessionId: UUID } }));
  assert.equal(calls.terminals.length, 1);

  reset(); state.settings['claudeCode.useTerminal'] = true; state.settings['mycelium.claudeCode.openIn'] = 'panel';
  await openLaunch(launch({ panel: { sessionId: UUID } }));
  assert.equal(calls.terminals.length, 0, 'panel forces it even when Claude Code prefers the terminal');
});

test('a launch without a panel request is always a terminal; other agents never use the panel', async () => {
  reset();
  await openLaunch(launch());
  assert.equal(calls.terminals.length, 1);
  assert.equal(panelWanted('codex'), false);
  assert.equal(panelWanted('claude'), true);
});

test('asking for the panel by name, without the extension, says why it is a terminal; in auto it stays quiet', async () => {
  reset(); state.installed = false; state.settings['mycelium.claudeCode.openIn'] = 'panel';
  await openLaunch(launch({ panel: { sessionId: UUID } }));
  assert.equal(calls.terminals.length, 1);
  assert.match(calls.warn[0], /not installed or enabled in this window/);

  reset(); state.installed = false; // auto
  await openLaunch(launch({ panel: { sessionId: UUID } }));
  assert.equal(calls.terminals.length, 1);
  assert.equal(calls.warn.length, 0);

  reset(); state.settings['claudeCode.useTerminal'] = true; // installed, but Claude Code prefers the terminal
  await openLaunch(launch({ panel: { sessionId: UUID } }));
  assert.equal(calls.warn.length, 0, 'a preference is not a problem to report');
});

test('every launch decision is written to the log, so a panel that did not open can be explained', async () => {
  reset();
  const lines = [];
  const log = { appendLine: (l) => lines.push(l) };
  await openLaunch(launch({ panel: { sessionId: UUID } }), log);
  assert.match(lines[0], /launch: claude in \/p; panel requested: yes; Claude Code: 2\.1\.296 \(active\)/);
  assert.ok(lines.some((l) => l.includes(`${PANEL_COMMAND}(session=${UUID}, prompt=none)`)));
  assert.ok(lines.some((l) => /command returned/.test(l)));

  reset(); lines.length = 0; state.settings['claudeCode.useTerminal'] = true;
  await openLaunch(launch({ panel: { sessionId: UUID } }), log);
  assert.ok(lines.some((l) => /panel not used: mycelium\.claudeCode\.openIn=undefined, claudeCode\.useTerminal=true/.test(l)));

  reset(); lines.length = 0; state.installed = false;
  await openLaunch(launch({ panel: {} }), log);
  assert.match(lines[0], /not installed\/enabled here/);
});

test('a Claude session opens in the panel even when `claude` is not on PATH (Claude Code ships its own)', async () => {
  reset();
  await openLaunch(launch({ binMissing: true, panel: { sessionId: UUID } }));
  assert.deepEqual(calls.exec.at(-1), [PANEL_COMMAND, UUID, undefined]);
  assert.equal(calls.terminals.length, 0);
  assert.equal(calls.errors.length, 0);
});

test('with no `claude` on PATH and no panel to use, say so instead of opening a terminal that cannot run it', async () => {
  for (const setup of [
    () => { state.installed = false; },                                  // no Claude Code extension
    () => { state.settings['claudeCode.useTerminal'] = true; },          // Claude Code prefers the terminal
    () => { state.execFails = new Error('boom'); },                      // the panel call fails
  ]) {
    reset(); setup();
    await openLaunch(launch({ binMissing: true, panel: { sessionId: UUID } }));
    assert.equal(calls.terminals.length, 0, 'no terminal that would only print "command not found"');
    assert.match(calls.errors.at(-1), /claude is not installed.*Claude Code panel isn't available/s);
  }
});

test('a missing binary only matters when a terminal was the way to run it', async () => {
  reset();
  await openLaunch(launch()); // no binMissing, no panel: the normal terminal launch
  assert.equal(calls.terminals.length, 1);
  assert.equal(calls.errors.length, 0);
});
