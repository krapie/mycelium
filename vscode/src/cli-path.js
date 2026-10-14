/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

// An editor started from the Dock/Finder doesn't have the PATH of the user's
// shell — if VS Code can't resolve it in time (its "Unable to resolve your
// shell environment" message) the extension host gets /usr/bin:/bin:… only.
// Then `mycelium` isn't found, and even an absolute path fails: the script
// starts with `#!/usr/bin/env node`, and node lives beside it (often
// /opt/homebrew/bin), which isn't on that PATH either. So the extension finds
// the CLI itself and gives the child a PATH that can run it.
//
// Everything takes platform/env/exists so each OS is tested from any host.

const pathApi = (platform) => (platform === 'win32' ? path.win32 : path.posix);
const delimiterOf = (platform) => (platform === 'win32' ? ';' : ':');
const pathKey = (env, platform) => (platform === 'win32' && Object.keys(env).find((k) => k.toUpperCase() === 'PATH')) || 'PATH';

function pathDirs(env, platform) {
  return String(env[pathKey(env, platform)] || '')
    .split(delimiterOf(platform))
    .map((d) => d.replace(/^"|"$/g, ''))
    .filter(Boolean);
}

/** Where a global npm/Homebrew/version-manager install usually puts executables, newest node first. Only ones that exist. */
function knownDirs({ platform = process.platform, env = process.env, home = os.homedir(), exists = fs.existsSync, readdir = (d) => fs.readdirSync(d) } = {}) {
  const p = pathApi(platform);
  const dirs = [];
  if (platform === 'win32') {
    if (env.APPDATA) dirs.push(p.join(env.APPDATA, 'npm'));
    dirs.push(p.join(env.ProgramFiles || 'C:\\Program Files', 'nodejs'));
    if (env.LOCALAPPDATA) dirs.push(p.join(env.LOCALAPPDATA, 'Volta', 'bin'));
  } else {
    dirs.push('/opt/homebrew/bin', '/usr/local/bin', p.join(home, '.local/bin'), p.join(home, '.npm-global/bin'), p.join(home, '.volta/bin'), p.join(home, '.local/share/mise/shims'), p.join(home, '.asdf/shims'));
    // nvm / fnm keep one bin dir per node version; the newest is the best guess
    for (const [root, tail] of [[p.join(home, '.nvm/versions/node'), 'bin'], [p.join(home, '.local/share/fnm/node-versions'), 'installation/bin']]) {
      try {
        const versions = readdir(root).filter((v) => /^v?\d/.test(v)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        for (const v of versions) dirs.push(p.join(root, v, tail));
      } catch {
        /* not installed */
      }
    }
    dirs.push('/usr/bin');
  }
  return dirs.filter((d) => exists(d));
}

const unique = (list) => [...new Set(list)];

/**
 * Find the CLI. An absolute `configured` path is trusted as given; otherwise
 * the name is looked up on PATH, then in the usual install locations (and in
 * `extraDirs`, e.g. the PATH of the user's login shell).
 */
function resolveCli({ configured = 'mycelium', env = process.env, platform = process.platform, home = os.homedir(), exists = fs.existsSync, readdir, extraDirs = [] } = {}) {
  const p = pathApi(platform);
  if (p.isAbsolute(configured) || /[\\/]/.test(configured)) {
    return { command: configured, dir: p.dirname(configured), searched: [], from: 'setting' };
  }
  const onPath = pathDirs(env, platform);
  const known = knownDirs({ platform, env, home, exists, readdir });
  const dirs = unique([...onPath, ...extraDirs, ...known]);
  const names = platform === 'win32' ? ['.cmd', '.exe', '.bat', ''].map((e) => configured + e) : [configured];
  for (const dir of dirs) {
    for (const name of names) {
      const full = p.join(dir, name);
      if (exists(full)) return { command: full, dir, searched: dirs, from: onPath.includes(dir) ? 'PATH' : 'known location' };
    }
  }
  return { command: configured, dir: null, searched: dirs, from: null };
}

/** PATH for the child: the CLI's own directory first (node sits beside it), then the usual locations, then what we had. */
function childEnv({ env = process.env, platform = process.platform, dir = null, home = os.homedir(), exists = fs.existsSync, readdir, extraDirs = [] } = {}) {
  const value = unique([dir, ...extraDirs, ...knownDirs({ platform, env, home, exists, readdir }), ...pathDirs(env, platform)].filter(Boolean)).join(delimiterOf(platform));
  return { [pathKey(env, platform)]: value };
}

const MARK = '__MYCELIUM_PATH__';

/**
 * Last resort: ask the user's login shell for its PATH, with OUR timeout (VS
 * Code's is 10s and gives up with a modal). Async — a slow shell must not
 * freeze the extension host. Resolves to the PATH string, or null on any failure.
 */
function loginShellPath({ shell = process.env.SHELL, timeoutMs = 15000, spawnFn = spawn, platform = process.platform } = {}) {
  return new Promise((resolve) => {
    if (!shell || platform === 'win32') return resolve(null);
    let out = '';
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    };
    let child;
    try {
      // The markers keep whatever the user's rc files print out of the result.
      child = spawnFn(shell, ['-ilc', `printf '%s' "${MARK}$PATH${MARK}"`], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return resolve(null);
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* gone */
      }
      finish(null);
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => finish(null));
    child.on('close', () => {
      const m = out.match(new RegExp(`${MARK}(.*?)${MARK}`, 's'));
      finish(m && m[1] ? m[1] : null);
    });
  });
}

module.exports = { knownDirs, resolveCli, childEnv, loginShellPath, pathDirs };
