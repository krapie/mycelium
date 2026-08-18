import { readFileSync } from 'node:fs';

// Resolves through symlinks to the real package.json regardless of install
// method (npm global, Homebrew Cellar, npm-link dev checkout) — always
// reflects what's actually running, no separate constant to keep in sync.
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));

export const VERSION = pkg.version;
