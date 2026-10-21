/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

import { ADAPTERS } from './adapters/index.js';

/**
 * `--here`: the session a command was run from, for commands an agent runs
 * mid-conversation (a /clip slash command calling `mycelium clip add --here`).
 *
 * Only an id the agent itself hands its shell (an adapter's optional
 * `sessionEnv`) counts. Guessing from cwd + recency would pick the wrong
 * conversation whenever two are open in one project, and a clip filed under
 * the wrong session is worse than being asked for the id — so without one
 * this fails and says how to pass it.
 *
 * More than one can be set: an agent started from another agent's shell
 * inherits the outer one's variable (found running kiro-cli from Claude
 * Code's Bash tool — the clip landed in the Claude session). The inner agent
 * is the one running this, and it logged the tool call that did so after the
 * outer one went quiet to wait on it, so the newest transcript wins.
 */
export function resolveHere({ env = process.env, adapters = ADAPTERS, mtimeOf = transcriptMtime } = {}) {
  const found = adapters.filter((a) => a.sessionEnv && env[a.sessionEnv]).map((a) => ({ sessionId: env[a.sessionEnv], source: a.name, adapter: a }));
  if (!found.length) {
    return {
      ok: false,
      error: '--here: this agent does not tell its shell which session it is in — pass the session id instead (mycelium list)',
    };
  }
  const pick = found.length === 1 ? found[0] : found.reduce((a, b) => (mtimeOf(b) > mtimeOf(a) ? b : a));
  return { ok: true, sessionId: pick.sessionId, source: pick.source };
}

function transcriptMtime({ adapter, sessionId }) {
  try {
    return adapter.listSessions().find((r) => r.id === sessionId)?.mtimeMs ?? 0;
  } catch {
    return 0;
  }
}
