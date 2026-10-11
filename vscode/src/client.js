'use strict';
const { spawn } = require('node:child_process');

/**
 * Line-delimited JSON-RPC client over a `mycelium serve --stdio` child.
 * Deliberately free of any `vscode` import so node:test can drive it with a
 * fake child. The process starts on first use and restarts on the next
 * request after it dies, so a crashed CLI costs one failed call, not a
 * dead extension.
 */
class Client {
  constructor({ command = 'mycelium', env = {}, timeoutMs = 60000, spawnFn = spawn } = {}) {
    this.command = command;
    this.env = env;
    this.timeoutMs = timeoutMs;
    this.spawnFn = spawnFn;
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map();
    this.progress = new Map(); // token -> onProgress
    this.buf = '';
  }

  start() {
    if (this.proc) return this.proc;
    const proc = this.spawnFn(this.command, ['serve', '--stdio'], {
      env: { ...process.env, ...this.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc = proc;
    this.buf = '';
    proc.stdout.on('data', (d) => this.onData(String(d)));
    proc.stderr?.on('data', () => {});
    // 'error' (ENOENT: CLI not installed) and 'close' both end up here; the
    // pending calls fail with the reason instead of waiting for a timeout.
    const died = (err) => {
      if (this.proc === proc) this.proc = null;
      this.failAll(err);
    };
    proc.on('error', (e) => died(e.code === 'ENOENT' ? Object.assign(new Error(`mycelium CLI not found: ${this.command}`), { code: 'ENOENT' }) : e));
    proc.on('close', (code) => died(new Error(`mycelium serve exited (${code})`)));
    return proc;
  }

  onData(chunk) {
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
        continue;
      }
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
  request(method, params = {}, { onProgress } = {}) {
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
