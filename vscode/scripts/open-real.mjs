// Opens an Extension Development Host on your REAL ~/.mycelium store, with
// this repo as the workspace so "This Workspace" has sessions in it.
// Unlike `npm run dev` nothing is seeded or wiped — what you see is yours, and
// what you do (scan, move, tag, summarize, organize) is written to it.
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, existsSync, lstatSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const extDir = resolve(here, '..');
const repo = resolve(here, '../..');
const cli = join(repo, 'src/cli.js'); // the installed `mycelium` may predate `serve`

// A .code-workspace carries the settings, so the real store is selected
// (empty `mycelium.home` = ~/.mycelium) without editing anyone's user settings
// or leaving a .vscode/ folder inside the repo.
const file = join(homedir(), '.mycelium-vscode-real.code-workspace');
writeFileSync(file, JSON.stringify({ folders: [{ path: repo }], settings: { 'mycelium.path': cli, 'mycelium.home': '' } }, null, 2) + '\n');

// VS Code does not open a second window for an --extensionDevelopmentPath it
// already has open: it reloads the existing one. `npm run dev` (sample data)
// uses extDir, so reaching it again here would just reload THAT window and
// the real store would never show. A different path string to the same
// folder is a different window.
const alias = join(homedir(), '.mycelium-vscode-real-ext');
if (!existsSync(alias) || !lstatSync(alias).isSymbolicLink() || readlinkSync(alias) !== extDir) {
  if (existsSync(alias) && !lstatSync(alias).isSymbolicLink()) {
    console.error(`${alias} exists and is not a symlink; refusing to replace it`);
    process.exit(1);
  }
  try {
    unlinkSync(alias);
  } catch {
    /* none yet */
  }
  symlinkSync(extDir, alias);
}

const r = spawnSync('code', ['--new-window', `--extensionDevelopmentPath=${alias}`, file], { stdio: 'inherit' });
if (r.error) {
  console.error(`could not run \`code\`: ${r.error.message}\n(VS Code: Command Palette → "Shell Command: Install 'code' command in PATH")`);
  process.exit(1);
}
console.log(`opened ${file}\nstore: ${join(homedir(), '.mycelium')} (real)`);
