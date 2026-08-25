import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';

// Mycelium's own data home. Files are the source of truth; the sqlite index
// under db/ is a derived artifact that can be rebuilt from raw/ at any time.
export const HOME = process.env.MYCELIUM_HOME || join(homedir(), '.mycelium');

export const RAW_DIR = join(HOME, 'raw'); // normalized neutral-schema sessions
export const TREE_DIR = join(HOME, 'tree'); // user folder structure = real dirs
export const DIGEST_DIR = join(HOME, 'digests');
export const DB_DIR = join(HOME, 'db');
export const DB_PATH = join(DB_DIR, 'index.db');
export const CONFIG_PATH = join(HOME, 'config.json');
export const INBOX = join(TREE_DIR, '_inbox');
export const DAEMON_PID_PATH = join(HOME, 'daemon.pid'); // same file scripts/run.sh writes
export const DAEMON_LOG_PATH = join(HOME, 'daemon.log');

export function ensureDirs() {
  for (const d of [HOME, RAW_DIR, TREE_DIR, DIGEST_DIR, DB_DIR, INBOX]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

/**
 * Is `folderPath` safe to join onto TREE_DIR? Several call sites
 * (reuse.js's assembleContext(), organize/folders.js's folder CRUD,
 * insight.js's KNOWLEDGE.md writers) turn a folderPath into a real
 * directory via `join(TREE_DIR, ...folderPath.split('/'))` — a value
 * containing '..' segments would otherwise let that resolve outside
 * TREE_DIR entirely (found via CodeRabbit review on #91; folderPath can
 * reach these from external input like the CLI's --folder/mkdir/mv args
 * with no upstream validation).
 */
export function isSafeFolderPath(folderPath) {
  if (!folderPath || typeof folderPath !== 'string') return false;
  if (folderPath.startsWith('/') || folderPath.startsWith('\\')) return false;
  return folderPath.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}
