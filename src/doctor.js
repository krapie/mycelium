/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter } from 'node:path';
import { VERSION } from './version.js';
import { HOME, RAW_DIR, DB_PATH, DAEMON_PID_PATH, DAEMON_LOG_PATH } from './paths.js';
import { loadConfig, contentLocale } from './config.js';
import { AGENTS, whichPath } from './agents.js';
import { providerBin } from './llm.js';

// The report is pasted into public issues; an https remote may carry user:token@.
const redactUrl = (s) => String(s).replace(/(\/\/)[^/@\s]+@/, '$1***@');

const lastLine = (file) => {
  try {
    const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
    return lines[lines.length - 1] || null;
  } catch {
    return null;
  }
};

const pidAlive = (file) => {
  try {
    process.kill(Number(readFileSync(file, 'utf8').trim()), 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * Everything that has explained a "works on my machine" report so far: which
 * PATH this process really has (an editor started from the Dock often lacks
 * the login shell's), where each agent CLI and git resolve to, and the state
 * of the store. Plain data so the CLI prints it and the editor bridge returns
 * it; `extraPath` mirrors the bridge's login-shell PATH hint.
 */
export function collectDiagnostics({ extraPath, env = process.env, platform = process.platform } = {}) {
  // Windows spells it `Path`; widen that key, or whichPath() would read the original and ignore extraPath.
  const pathKey = (platform === 'win32' && Object.keys(env).find((k) => k.toUpperCase() === 'PATH')) || 'PATH';
  const lookupEnv = Array.isArray(extraPath) && extraPath.length ? { ...env, [pathKey]: [...extraPath, env[pathKey]].filter(Boolean).join(delimiter) } : env;
  const find = (bin) => whichPath(bin, { env: lookupEnv, platform });
  const llmBin = providerBin();
  const cfg = loadConfig();
  // A store that cannot be read is exactly when this report is needed, so it must not throw.
  let raw;
  try {
    raw = existsSync(RAW_DIR) ? readdirSync(RAW_DIR).filter((f) => f.endsWith('.json')).length : 0;
  } catch {
    raw = null;
  }
  return {
    version: VERSION,
    node: process.version,
    platform: `${platform} ${process.arch}`,
    shell: env.SHELL || env.ComSpec || null,
    home: HOME,
    locale: contentLocale(),
    path: (lookupEnv.PATH || lookupEnv.Path || '').split(delimiter).filter(Boolean),
    agents: Object.entries(AGENTS).map(([key, a]) => ({ key, bin: a.bin, path: find(a.bin) })),
    llm: { provider: process.env.MYCELIUM_LLM || 'auto', bin: llmBin, path: llmBin ? find(llmBin) : null },
    git: find('git'),
    ssh: find('ssh'),
    store: {
      sessions: raw,
      index: existsSync(DB_PATH),
      daemon: existsSync(DAEMON_PID_PATH) ? (pidAlive(DAEMON_PID_PATH) ? 'running' : 'stale pid file') : 'not running',
      lastLog: lastLine(DAEMON_LOG_PATH),
    },
    sync: cfg.sync?.remote ? { remote: redactUrl(cfg.sync.remote), mode: cfg.sync.mode } : null,
  };
}

/** Plain text meant to be pasted into an issue: the user's home directory is shown as ~. */
export function formatDiagnostics(d, { home = homedir() } = {}) {
  const hide = (s) => (s && home ? String(s).split(home).join('~') : s);
  const found = (p) => (p ? hide(p) : 'NOT FOUND');
  const lines = [
    `mycelium ${d.version}  node ${d.node}  ${d.platform}`,
    `shell: ${d.shell || '(unknown)'}   locale: ${d.locale}`,
    `store: ${hide(d.home)}  (${d.store.sessions ?? 'unreadable'} sessions, index ${d.store.index ? 'present' : 'missing'}, daemon ${d.store.daemon})`,
  ];
  if (d.store.lastLog) lines.push(`last daemon log: ${hide(d.store.lastLog)}`);
  lines.push('', 'agent CLIs:');
  for (const a of d.agents) lines.push(`  ${a.key.padEnd(12)} ${a.bin.padEnd(10)} ${found(a.path)}`);
  lines.push('', `LLM provider: ${d.llm.provider}${d.llm.bin ? ` -> ${d.llm.bin}: ${found(d.llm.path)}` : ''}`);
  lines.push(`git: ${found(d.git)}   ssh: ${found(d.ssh)}`);
  if (d.sync) lines.push(`sync: ${d.sync.remote} (${d.sync.mode || 'push'})`);
  lines.push('', `PATH (${d.path.length} directories):`);
  for (const p of d.path) lines.push(`  ${hide(p)}`);
  return lines.join('\n');
}
