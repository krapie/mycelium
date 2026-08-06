/**
 * Adapter contract. Each adapter is a module exporting:
 *
 *   name: string                        — matches the session's `source` field
 *                                          exactly ("claude" | "codex" | "kiro" | ...)
 *   label: string                       — human-readable name for the agent
 *                                          picker ("Claude Code")
 *   bin: string                         — the CLI binary to spawn
 *   newArgs(seed?): string[]            — args to start a NEW session; `seed`
 *                                          optionally pre-fills the first prompt
 *   resumeArgs(sessionId): string[]     — args to resume an EXISTING session
 *   listSessions(): SessionRef[]        — { id, path, mtimeMs } for every session on disk
 *   parse(ref): Neutral                 — parse ONE session file into the neutral schema
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
