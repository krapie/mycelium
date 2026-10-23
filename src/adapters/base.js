/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

/**
 * Adapter contract. Each adapter is a module exporting:
 *
 *   name: string                        — matches the session's `source` field
 *                                          exactly ("claude" | "codex" | "kiro" | "opencode" | ...)
 *   label: string                       — human-readable name for the agent
 *                                          picker ("Claude Code")
 *   bin: string                         — the CLI binary to spawn
 *   newArgs(seed?): string[]            — args to start a NEW session; `seed`
 *                                          optionally pre-fills the first prompt
 *   resumeArgs(sessionId): string[]     — args to resume an EXISTING session
 *   listSessions(): SessionRef[]        — { id, path, mtimeMs } for every session on disk
 *   parse(ref): Neutral                 — parse ONE session file into the neutral schema
 *   sessionEnv?: string                 — optional: the env var the CLI sets
 *                                          in its tool shells to the current
 *                                          session id (what `--here` reads,
 *                                          see here.js). Omit if it has none.
 *   commandInstall?: {                  — optional: where `mycelium setup`
 *     dir: string,                         copies this agent's command files
 *     files: { from, to }[],               (`src/agent-commands/<from>` →
 *     note?: (home) => string,             `<dir>/<to>`). Omit if the agent
 *   }                                      has no command/prompt/skill format.
 *                                          `dir` reads an env override first,
 *                                          like the session roots above, so
 *                                          tests never write to a real
 *                                          ~/.claude. `note` is printed after
 *                                          install for a step Mycelium must
 *                                          not take itself (see codex.js).
 *
 * Adapters only ever READ the CLI's own session files — never write them,
 * never touch auth tokens. A parse failure must throw so the scanner can skip
 * that one session (CLI formats drift across versions — see authsec-bridge's
 * Codex 0.122→0.128 breakage — so one bad file must not kill a whole scan).
 *
 * Presentation (which color a source gets) is deliberately NOT part of this
 * contract — see tui/theme.js's sourceColor(). That keeps adapters (data
 * layer) free of any dependency on tui/ (UI layer); a new agent always needs
 * an actual color picked by a human anyway, unlike everything else here.
 *
 * Register a new adapter in adapters/index.js's ADAPTERS array — that's the
 * only other file that needs touching to add support for a new agent CLI.
 */
export const ADAPTER_CONTRACT = true;
