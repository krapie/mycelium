/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

'use strict';
const vscode = require('vscode');
const path = require('node:path');
const { isAgentTerminal } = require('./session-terminal.js');
const { state } = require('./state.js');

const ASKED_KEY = 'mycelium.upkeepAsked';
const SCAN_AFTER_CLOSE_MS = 4000;
// The daemon's queue lives outside raw/, which the extension watches, so while
// it runs the queue is read on a timer to notice new suggestions.
const POLL_MS = 2 * 60 * 1000;

/**
 * What to do about the background daemon when this window connects, from the
 * `mycelium.autoUpkeep` setting and whether the user was already asked.
 * 'off' never touches a daemon the user may have started themselves.
 */
function upkeepDecision({ setting, asked }) {
  if (setting === 'on') return 'start';
  if (setting === 'ask' && !asked) return 'ask';
  return 'none';
}

/** How many reviewable things the daemon has queued. */
const readyCount = (s) => (s ? (s.suggestions || 0) + (s.knowledge || 0) : 0);

/** One line for the menu and tooltip: running or not, which process and version, what is queued. */
function describeStatus(s, t) {
  if (!s) return t.upkeepUnknown;
  if (!s.running) return t.upkeepStateOff;
  const queued = readyCount(s) ? t.upkeepReady(s.suggestions, s.knowledge) : t.upkeepNothingQueued;
  return `${t.upkeepStateOn(s.pid, s.version)} · ${queued}`;
}

/**
 * A CLI from before these bridge methods answers "unknown method". That is
 * "no upkeep here", not an error worth a toast every poll.
 */
const isOldCli = (err) => !!err && /unknown method/.test(err.message || '');

/**
 * Keeps the extension's view of the detached daemon (`mycelium daemon
 * --detach`, the same upkeep the TUI runs in-process): starts it on the user's
 * say-so, reports when it has queued something to review, and, even with
 * upkeep off, scans for new sessions since that calls no LLM.
 */
function registerUpkeep(ctx, { client, refresh, run, t, log }) {
  let status = null;
  let supported = true;
  let baseline = null; // ready count at the last poll; the first poll sets it silently
  let warnedOld = false;

  const config = () => vscode.workspace.getConfiguration('mycelium');
  const setSetting = (value) => config().update('autoUpkeep', value, vscode.ConfigurationTarget.Global);

  // Said once per window; the actions that need upkeep then do nothing instead of failing.
  const markOld = () => {
    supported = false;
    status = null;
    if (warnedOld) return;
    warnedOld = true;
    log.appendLine('upkeep: this CLI predates background upkeep; falling back to manual actions');
    vscode.window.showWarningMessage(t.upkeepOld);
  };

  const fetchStatus = async () => {
    if (!supported) return null;
    try {
      status = await client.request('upkeepStatus');
    } catch (err) {
      if (!isOldCli(err)) throw err;
      markOld();
    }
    return status;
  };

  const start = async () => {
    if (!supported) return false;
    try {
      const r = await client.request('upkeepStart');
      log.appendLine(r.started ? `upkeep: started the daemon (pid ${r.pid})${r.restarted ? `, replacing ${r.from}` : ''}` : `upkeep: daemon already running (pid ${r.pid})`);
      await fetchStatus();
      await refresh();
      return true;
    } catch (err) {
      if (!isOldCli(err)) throw err;
      markOld();
      return false;
    }
  };

  const stop = async () => {
    if (!supported) return;
    await client.request('upkeepStop');
    await fetchStatus();
    await refresh();
  };

  // No LLM call, so it runs whatever the setting says. Skipped while the daemon
  // is up: it already scans every few minutes, and two scanners only race.
  let quietTimer;
  const quietScan = (delay = 0) => {
    clearTimeout(quietTimer);
    quietTimer = setTimeout(async () => {
      try {
        if (status && status.running) return;
        const s = await client.request('scan');
        if (s && s.imported) await refresh();
      } catch (err) {
        log.appendLine(`upkeep: quiet scan failed: ${err.message}`);
      }
    }, delay);
  };

  const ask = async () => {
    await ctx.globalState.update(ASKED_KEY, true);
    const pick = await vscode.window.showInformationMessage(t.upkeepAsk, t.upkeepTurnOn, t.upkeepNotNow, t.upkeepNever);
    if (pick === t.upkeepTurnOn) {
      await setSetting('on');
      if (await start()) vscode.window.setStatusBarMessage(t.upkeepStarted, 3000);
    } else if (pick === t.upkeepNever) await setSetting('off');
  };

  /** Called once the CLI answered `hello`. */
  const connected = async () => {
    supported = true; // the CLI may have been updated or swapped since the last connect
    quietScan(1500); // not waiting on the status request (it may fail), but late enough that a running daemon is seen first
    await fetchStatus();
    const decision = upkeepDecision({ setting: config().get('autoUpkeep'), asked: ctx.globalState.get(ASKED_KEY) });
    if (decision === 'start') await start();
    else if (decision === 'ask' && supported) ask().catch((e) => log.appendLine(`upkeep: ${e.message}`));
  };

  /**
   * Fed with each poll of the daemon's queue: one non-modal nudge when
   * something new is waiting, never on the first look.
   */
  const observe = (s) => {
    status = s;
    const ready = readyCount(s);
    const grew = baseline !== null && ready > baseline;
    baseline = ready;
    if (!grew) return;
    vscode.window.showInformationMessage(`Mycelium: ${t.upkeepReady(s.suggestions, s.knowledge)}`, t.upkeepReview).then((pick) => {
      if (!pick) return;
      if (s.suggestions) vscode.commands.executeCommand('mycelium.organize');
      else vscode.commands.executeCommand('mycelium.reviewKnowledge');
    });
  };

  ctx.subscriptions.push(
    vscode.window.onDidCloseTerminal((term) => {
      if (isAgentTerminal(term)) quietScan(SCAN_AFTER_CLOSE_MS);
    }),
    { dispose: () => clearTimeout(quietTimer) },
  );
  const poll = setInterval(() => {
    if (status && status.running) refresh().catch(() => {});
  }, POLL_MS);
  ctx.subscriptions.push({ dispose: () => clearInterval(poll) });

  run('mycelium.upkeepOn', async () => {
    await setSetting('on');
    if (await start()) vscode.window.showInformationMessage(t.upkeepStarted);
  });

  run('mycelium.upkeepOff', async () => {
    await setSetting('off');
    await stop();
    vscode.window.showInformationMessage(t.upkeepStopped);
  });

  run('mycelium.daemonLog', () => {
    if (state.home) return vscode.window.showTextDocument(vscode.Uri.file(path.join(state.home, 'daemon.log')));
  });

  // Stop then start: start replaces nothing, and a daemon that kept old code
  // after a CLI update (or got stuck) comes back on the installed version.
  run('mycelium.upkeepRestart', async () => {
    await stop();
    if (await start()) vscode.window.showInformationMessage(t.upkeepRestarted(status && status.version));
  });

  run('mycelium.upkeepMenu', async () => {
    await fetchStatus().catch(() => null); // what the menu shows should be what is true now
    const running = !!(status && status.running);
    const items = [
      { label: describeStatus(status, t), kind: vscode.QuickPickItemKind.Separator },
      { label: `$(run-all) ${t.upkeepRunNow}`, cmd: 'mycelium.runAll' },
      ...(running
        ? [{ label: `$(debug-restart) ${t.upkeepRestart}`, cmd: 'mycelium.upkeepRestart' }, { label: `$(debug-stop) ${t.upkeepTurnOff}`, cmd: 'mycelium.upkeepOff' }]
        : [{ label: `$(play) ${t.upkeepTurnOnItem}`, cmd: 'mycelium.upkeepOn' }]),
      { label: `$(output) ${t.upkeepShowLog}`, cmd: 'mycelium.daemonLog' },
    ];
    const pick = await vscode.window.showQuickPick(items, { placeHolder: `${t.actions.upkeep.label}: ${running ? t.upkeepOn : t.upkeepOff}` });
    if (pick && pick.cmd) await vscode.commands.executeCommand(pick.cmd);
  });

  return { connected, observe, fetchStatus, describe: () => describeStatus(status, t), isRunning: () => !!(status && status.running), isSupported: () => supported };
}

module.exports = { registerUpkeep, upkeepDecision, readyCount, isOldCli, describeStatus };
