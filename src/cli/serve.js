/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

import { createInterface } from 'node:readline';
import { handle, LONG } from '../bridge.js';

/**
 * `mycelium serve --stdio` — newline-delimited JSON-RPC 2.0 over stdin/stdout
 * for editor integrations (vscode/, docs/vscode.md). Runs until stdin closes.
 */
export function serveCmd() {
  // stdout is the protocol channel: one stray console.log from any module the
  // bridge reaches would corrupt a response line and desync the client, so
  // everything that isn't a reply goes to stderr.
  const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
  console.log = console.warn = console.info = (...a) => console.error(...a);

  // Ordinary requests run one at a time, in arrival order: the handlers write
  // the same raw/ files and sqlite index, and a client expects its move to be
  // visible to the list call it sends next. LLM-backed ones (LONG) run for
  // minutes, so they skip the queue — otherwise a refresh would sit behind a
  // summarize run — and report progress as id-less notifications instead.
  const ctx = { notify: (method, params) => send({ jsonrpc: '2.0', method, params }) };
  let queue = Promise.resolve();
  let inflight = 0;
  const rl = createInterface({ input: process.stdin });
  const dispatch = async (line) => {
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
    }
    const res = await handle(req, ctx);
    if (res) send(res);
  };
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let method;
    try {
      method = JSON.parse(line).method;
    } catch {
      /* dispatch() reports the parse error in order */
    }
    if (LONG.has(method)) {
      inflight++;
      dispatch(line).finally(() => inflight--);
    } else {
      queue = queue.then(() => dispatch(line));
    }
  });
  // stdin closing while a summarize run is still going would otherwise exit
  // under it; wait for it so its writes finish.
  rl.on('close', async () => {
    await queue;
    while (inflight) await new Promise((r) => setTimeout(r, 50));
    process.exit(0);
  });
}
