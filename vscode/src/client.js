'use strict';
const { spawn } = require('node:child_process');
const { MIN_CLI } = require('./version.js');

// "node" missing, as each shell/OS words it. GNU env quotes with typographic
// quotes (`env: ‘node’: No such file`), hence \W? rather than ' or ".
const NO_NODE = /env: \W?node\W?: |node: (command )?not found|not found: node|'node' is not recognized/i;

/**
 * Line-delimited JSON-RPC client over a `mycelium serve --stdio` child.
 * Deliberately free of any `vscode` import so node:test can drive it with a
 * fake child. The process starts on first use and restarts on the next
 * request after it dies, so a crashed CLI costs one failed call, not a
 * dead extension.
 */
class Client {
  // `resolver` (optional, async) finds the CLI and says what PATH to run it with
  // — `{ command, env }` — and is asked once, before the first spawn (and again
  // after a "not found", in case it has been installed since). Without one,
  // `command` is used as given. `log` gets one line per notable event.
  constructor({ command = 'mycelium', env = {}, timeoutMs = 60000, spawnFn = spawn, platform = process.platform, resolver = null, log = () => {} } = {}) {
    this.command = command;
    this.env = env;
    this.resolver = resolver;
    this.log = log;
    this.spec = null;
    this.timeoutMs = timeoutMs;
    this.spawnFn = spawnFn;
    this.platform = platform;
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map();
    this.progress = new Map(); // token -> onProgress
    this.buf = '';
  }

  start() {
    if (this.proc) return this.proc;
    // On Windows an npm-installed CLI is `mycelium.cmd`, which spawn() can only
    // run through a shell; a shell also needs a path with spaces quoted.
    const win = this.platform === 'win32';
    const spec = this.spec || { command: this.command, env: {} };
    const command = win && /\s/.test(spec.command) && !/^".*"$/.test(spec.command) ? `"${spec.command}"` : spec.command;
    this.log(`starting: ${command} serve --stdio${spec.env.PATH || spec.env.Path ? `  (PATH=${spec.env.PATH || spec.env.Path})` : ''}`);
    const proc = this.spawnFn(command, ['serve', '--stdio'], {
      env: { ...process.env, ...spec.env, ...this.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: win,
      windowsHide: true,
    });
    // What the child's stdout turned out to be: a JSON-RPC message (it is
    // `serve`), or other text (it is something else printing its help).
    const seen = (this.seen = { json: false, text: false });
    this.proc = proc;
    this.buf = '';
    proc.stdout.on('data', (d) => this.onData(String(d), seen));
    // What the child said on stderr is the only explanation of a start-up
    // failure ("env: node: No such file or directory"); keep the tail of it.
    let stderrTail = '';
    proc.stderr?.on('data', (d) => {
      stderrTail = (stderrTail + String(d)).slice(-500);
    });
    // 'error' (ENOENT: CLI not installed) and 'close' both end up here; the
    // pending calls fail with the reason instead of waiting for a timeout.
    const died = (err) => {
      if (this.proc === proc) this.proc = null;
      this.failAll(err);
    };
    // The child can exit between a request being queued and written; the write
    // then fails on stdin itself, and an unhandled stream 'error' would take
    // the whole extension host down instead of failing just this call.
    if (proc.stdin && proc.stdin.on) proc.stdin.on('error', (e) => died(e));
    proc.on('error', (e) => {
      if (e.code !== 'ENOENT') return died(e);
      this.spec = null; // look again next time: it may have been installed meanwhile
      this.log(`not found: ${command}`);
      died(Object.assign(new Error(`mycelium CLI not found: ${spec.command}`), { code: 'ENOENT' }));
    });
    proc.on('close', (code) => {
      this.log(`exited (${code})${stderrTail.trim() ? `; stderr: ${stderrTail.trim()}` : ''}`);
      // The CLI was found but its `#!/usr/bin/env node` wasn't: node isn't on
      // the PATH this process was given.
      if (NO_NODE.test(stderrTail)) {
        return died(Object.assign(new Error(`Node.js was not found, which the mycelium CLI needs (version 22.16 or newer). ${stderrTail.trim()}`), { code: 'NO_NODE' }));
      }
      // A CLI from before `serve` existed doesn't know the command: it prints
      // its help on stdout and exits (1 for 0.4.x, 0 for others), never once
      // speaking JSON-RPC. Say that, instead of an unexplained exit code.
      if (!seen.json && this.pending.size && (seen.text || code === 0)) {
        return died(Object.assign(new Error(`The mycelium command-line tool is too old for this extension (it needs ${MIN_CLI} or newer). Update it: npm install -g @kevinprk/mycelium`), { code: 'OLD_CLI' }));
      }
      died(new Error(`mycelium serve exited (${code})${stderrTail.trim() ? `: ${stderrTail.trim()}` : ''}`));
    });
    return proc;
  }

  async resolveSpec() {
    try {
      this.spec = await this.resolver();
    } catch (e) {
      this.log(`could not resolve the CLI: ${e.message}`);
      this.spec = { command: this.command, env: {} };
    }
  }

  onData(chunk, seen = { json: false, text: false }) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        seen.text = true;
        continue;
      }
      seen.json = true;
      // No id = a notification. Progress lines carry the token of the request
      // they belong to, so a long call can report without being answered yet.
      if (msg.id === undefined) {
        if (msg.method === 'progress' && msg.params) this.progress.get(msg.params.token)?.(msg.params);
        continue;
      }
      const p = this.pending.get(msg.id);
      if (!p) continue;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code }));
      else p.resolve(msg.result);
    }
  }

  failAll(err) {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(id);
    }
  }

  /** `onProgress(info)` is called for each progress notification of THIS call. */
  request(method, params = {}, opts = {}) {
    // Resolution is async, so only a client with a resolver pays for it; one
    // without still spawns synchronously, in this very call.
    if (this.resolver && !this.spec && !this.proc) return this.resolveSpec().then(() => this.request(method, params, opts));
    const { onProgress } = opts;
    return new Promise((resolve, reject) => {
      let proc;
      try {
        proc = this.start();
      } catch (e) {
        return reject(e);
      }
      const id = this.nextId++;
      // A call that reports progress is a long one (an LLM run, minutes), so
      // the short default timeout would kill it mid-run; the caller cancels.
      const token = onProgress ? `t${id}` : undefined;
      if (token) this.progress.set(token, onProgress);
      const done = (fn) => (v) => {
        if (token) this.progress.delete(token);
        fn(v);
      };
      const timer = onProgress
        ? undefined
        : setTimeout(() => {
            this.pending.delete(id);
            reject(new Error(`mycelium ${method} timed out`));
          }, this.timeoutMs);
      this.pending.set(id, { resolve: done(resolve), reject: done(reject), timer });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: token ? { ...params, token } : params }) + '\n');
    });
  }

  dispose() {
    const proc = this.proc;
    this.proc = null;
    this.failAll(new Error('disposed'));
    if (proc) {
      try {
        proc.stdin.end();
        proc.kill();
      } catch {
        /* already gone */
      }
    }
  }
}

module.exports = { Client };
