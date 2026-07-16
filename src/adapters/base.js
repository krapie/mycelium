/**
 * Adapter contract. Each adapter is a module exporting:
 *
 *   name: string                       — "claude-code" | "codex" | ...
 *   listSessions(): SessionRef[]        — { id, path, mtimeMs } for every session on disk
 *   parse(ref): Neutral                 — parse ONE session file into the neutral schema
 *
 * Adapters only ever READ the CLI's own session files — never write them,
 * never touch auth tokens. A parse failure must throw so the scanner can skip
 * that one session (CLI formats drift across versions — see authsec-bridge's
 * Codex 0.122→0.128 breakage — so one bad file must not kill a whole scan).
 */
export const ADAPTER_CONTRACT = true;
